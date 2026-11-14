import { draftPage } from "../agents/drafter";
import { synthesizePageData } from "../agents/extractor";
import { reviewDraft } from "../agents/gatekeeper";
import { toJson, type DbTx } from "../db/client";
import type { PageStatus } from "../generated/prisma/enums";
import { sha256 } from "../lib/hash";
import { Mutex } from "../lib/log";
import { describeError, isRetryable } from "../llm/errors";
import { computeSignals, rankBySimilarity } from "../qa/signals";
import { comparisonTokens, draftProse, minhash, shingles, wordCount } from "../qa/text";
import {
  DraftContentSchema,
  entitySlugsOf,
  MAX_REVISIONS,
  PageDataSchema,
  QaIssueSchema,
  scoreQa,
  ToolFactSheetSchema,
  type QaResult,
  type RevisionContext,
} from "../schemas";
import { entityNamesOf, fromDbPageType, type PipelineDeps } from "./context";
import { ensureFactSheet } from "./facts";
import { upsertTags } from "./seed";
import { loadApprovedSiblings, nearestByEntities, toExcerpt } from "./siblings";

const LEASE_MS = 5 * 60_000;
const MAX_PAGE_ATTEMPTS = 4;
const RETRY_BASE_MS = 30_000;

const ACTIVE: PageStatus[] = ["QUEUED", "EXTRACTING", "DRAFTING", "IN_QA", "REVISING"];
export const isActive = (status: PageStatus) => ACTIVE.includes(status);

class LeaseLostError extends Error {}

/**
 * Approval reads the set of approved siblings and then adds to it, so two similar pages finishing
 * at the same moment must not both pass against a set that contains neither. One process: a mutex.
 * Several worker processes on Postgres: replace with pg_advisory_xact_lock on the vertical.
 */
const approvalLock = new Mutex();

/** A lease is taken only if nobody holds a live one; the conditional update makes that atomic. */
async function claim(deps: PipelineDeps, pageId: string): Promise<boolean> {
  const now = new Date();
  const claimed = await deps.db.page.updateMany({
    where: {
      id: pageId,
      status: { in: ACTIVE },
      nextAttemptAt: { lte: now },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }, { leaseOwner: deps.workerId }],
    },
    data: { leaseOwner: deps.workerId, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
  });
  return claimed.count === 1;
}

async function loadPage(deps: PipelineDeps, pageId: string) {
  return deps.db.page.findUniqueOrThrow({
    where: { id: pageId },
    include: {
      keyword: true,
      entities: { include: { entity: true, factSheet: true }, orderBy: { position: "asc" } },
    },
  });
}
type LoadedPage = Awaited<ReturnType<typeof loadPage>>;

/** Fencing: a worker whose lease was taken over can no longer write to the page. */
async function assertLease(deps: PipelineDeps, pageId: string): Promise<void> {
  const renewed = await deps.db.page.updateMany({
    where: { id: pageId, leaseOwner: deps.workerId },
    data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) },
  });
  if (renewed.count !== 1) throw new LeaseLostError(`lease on page ${pageId} was lost`);
}

function sheetsOf(page: LoadedPage) {
  return page.entities.flatMap((link) => (link.factSheet ? [ToolFactSheetSchema.parse(link.factSheet.data)] : []));
}

function siblingKey(page: LoadedPage) {
  return { id: page.id, verticalId: page.verticalId, pageType: page.pageType, entityIds: page.entities.map((link) => link.entityId) };
}

// ── Stage: EXTRACTING ────────────────────────────────────────────────────────────

async function extract(deps: PipelineDeps, page: LoadedPage): Promise<void> {
  const scope = `page ${page.slug}`;
  const sheets = await Promise.all(page.entities.map((link) => ensureFactSheet(deps, link.entity, page.id)));

  const pageData = await synthesizePageData(
    deps.llm,
    {
      keyword: {
        phrase: page.keyword.phrase,
        pageType: fromDbPageType(page.pageType),
        categorySlug: page.keyword.categorySlug,
        modifier: page.keyword.modifier,
      },
      entitySlugs: page.entities.map((link) => link.entity.slug),
      factSheets: sheets.map((entry) => entry.sheet),
      featureTaxonomy: deps.vertical.featureTaxonomy,
    },
    page.id,
  );
  deps.log.info(
    scope,
    `page data valid: ${pageData.matrix.length} matrix rows, ${pageData.useCaseVerdicts.length} verdicts, ${pageData.faqs.length} FAQs, ${pageData.costScenarios.length} cost scenarios (code)`,
  );

  await assertLease(deps, page.id);
  await deps.db.$transaction(async (tx) => {
    for (const [index, link] of page.entities.entries()) {
      const sheet = sheets[index];
      if (!sheet) continue;
      await tx.pageEntity.update({
        where: { pageId_entityId: { pageId: page.id, entityId: link.entityId } },
        data: { factSheetId: sheet.id },
      });
    }
    const tags = await upsertTags(tx, [...pageData.tags, ...entitySlugsOf(pageData)], deps);
    await tx.page.update({
      where: { id: page.id },
      data: { structuredData: toJson(pageData), status: "DRAFTING", tags: { set: tags } },
    });
  });
}

// ── Stage: DRAFTING / REVISING ───────────────────────────────────────────────────

async function draft(deps: PipelineDeps, page: LoadedPage): Promise<void> {
  const scope = `page ${page.slug}`;
  const attempt = page.revisionCount;
  const pageData = PageDataSchema.parse(page.structuredData);
  const factSheets = sheetsOf(page);

  let revision: RevisionContext | null = null;
  if (attempt > 0) {
    const previous = await deps.db.draft.findUniqueOrThrow({
      where: { pageId_attempt: { pageId: page.id, attempt: attempt - 1 } },
      include: { evaluation: true },
    });
    if (!previous.evaluation) throw new Error(`draft ${attempt - 1} has no evaluation to revise from`);
    revision = {
      attempt,
      previousDraft: DraftContentSchema.parse(previous.content),
      previousScore: previous.evaluation.totalScore,
      issues: QaIssueSchema.array().parse(previous.evaluation.issues),
    };
  }

  const siblings = nearestByEntities(await loadApprovedSiblings(deps.db, siblingKey(page)), entitySlugsOf(pageData));
  const input = {
    pageSlug: page.slug,
    keywordPhrase: page.keyword.phrase,
    pageData,
    factSheets,
    siblings: siblings.map(toExcerpt),
    revision,
  };

  // Same data + same critique ⇒ same draft: a re-run reuses the stored row instead of paying again.
  const inputHash = sha256({ pageData, factSheets, issues: revision?.issues ?? null, attempt });
  const existing = await deps.db.draft.findUnique({ where: { pageId_attempt: { pageId: page.id, attempt } } });
  if (existing?.inputHash === inputHash) {
    deps.log.info(scope, `draft #${attempt} already exists for these inputs → reused, no model call`);
  } else {
    if (revision) {
      deps.log.info(scope, `revision ${attempt}/${MAX_REVISIONS}: ${revision.issues.length} issue(s) sent back to the Drafting Agent`);
    }
    const result = await draftPage(deps.llm, input, page.id);
    await assertLease(deps, page.id);
    await deps.db.$transaction(async (tx) => {
      if (existing) await tx.qaEvaluation.deleteMany({ where: { draftId: existing.id } });
      await tx.draft.upsert({
        where: { pageId_attempt: { pageId: page.id, attempt } },
        create: { pageId: page.id, attempt, content: toJson(result.draft), inputHash, model: result.model },
        update: { content: toJson(result.draft), inputHash, model: result.model },
      });
    });
    deps.log.info(scope, `draft #${attempt} stored: "${result.draft.title}" (${result.draft.blocks.length} blocks, ${wordCount(draftProse(result.draft))} words)`);
  }
  await deps.db.page.update({ where: { id: page.id }, data: { status: "IN_QA" } });
}

// ── Stage: IN_QA ─────────────────────────────────────────────────────────────────

function describeResult(result: QaResult): string {
  const { informationGain, uniqueness, factConsistency } = result.dimensions;
  const blockers = result.issues.filter((issue) => issue.severity === "blocker").length;
  return `score ${result.total}/100 (info-gain ${informationGain} · uniqueness ${uniqueness} · fact-consistency ${factConsistency}; ${result.issues.length} issue(s), ${blockers} blocker(s))`;
}

async function review(deps: PipelineDeps, page: LoadedPage): Promise<void> {
  const scope = `page ${page.slug}`;
  const attempt = page.revisionCount;
  const draftRow = await deps.db.draft.findUniqueOrThrow({
    where: { pageId_attempt: { pageId: page.id, attempt } },
    include: { evaluation: true },
  });
  const draftContent = DraftContentSchema.parse(draftRow.content);
  const pageData = PageDataSchema.parse(page.structuredData);
  const factSheets = sheetsOf(page);
  const entityNames = entityNamesOf(deps.vertical);
  const prose = draftProse(draftContent);

  const measure = async () => {
    const siblings = await loadApprovedSiblings(deps.db, siblingKey(page));
    return { siblings, signals: computeSignals({ draft: draftContent, pageData, factSheets, siblings, entityNames }) };
  };

  let evaluation = draftRow.evaluation;
  if (evaluation) {
    deps.log.info(scope, `draft #${attempt} already evaluated → reused, no model call`);
  } else {
    const { siblings, signals } = await measure();
    deps.log.info(
      scope,
      `measured signals: similarity ${signals.maxSiblingSimilarity.toFixed(2)}${signals.nearestSiblingSlug ? ` vs ${signals.nearestSiblingSlug}` : ""}, copied blocks ${signals.copiedBlocks.length}/${draftContent.blocks.length}, unsupported numbers [${signals.unsupportedNumbers.join(", ")}], dangling refs ${signals.danglingRefs.length}, unanswered FAQs ${signals.missingFaqAnswers.length}, boilerplate ${signals.boilerplateHits.length}`,
    );
    const nearest = rankBySimilarity(prose, siblings, entityNames).slice(0, 3).map((entry) => toExcerpt(entry.sibling));
    const reviewed = await reviewDraft(
      deps.llm,
      { pageSlug: page.slug, keywordPhrase: page.keyword.phrase, attempt, draft: draftContent, pageData, factSheets, signals, siblings: nearest },
      page.id,
    );
    await assertLease(deps, page.id);

    // Decide and record under the approval lock, re-measuring first: a sibling approved while
    // this page was in review must count against it.
    evaluation = await approvalLock.run(async () => {
      const fresh = await measure();
      const unchanged = fresh.siblings.map((sibling) => sibling.id).join() === siblings.map((sibling) => sibling.id).join();
      const result = unchanged ? reviewed.result : scoreQa(reviewed.report, fresh.signals, attempt);
      const saved = await deps.db.$transaction(async (tx) => {
        const row = await tx.qaEvaluation.create({
          data: {
            pageId: page.id,
            draftId: draftRow.id,
            rubricVersion: result.rubricVersion,
            totalScore: result.total,
            informationGain: result.dimensions.informationGain,
            uniqueness: result.dimensions.uniqueness,
            factConsistency: result.dimensions.factConsistency,
            verdict: result.verdict === "pass" ? "PASS" : result.verdict === "revise" ? "REVISE" : "HUMAN_REVIEW",
            llmReport: toJson(reviewed.report),
            issues: toJson(result.issues),
            signals: toJson(fresh.signals),
            model: reviewed.model,
          },
        });
        await applyVerdict(tx, page, row.verdict, result.total, draftContent, entityNames);
        return row;
      });
      deps.log.info(scope, `QA attempt ${attempt}: ${describeResult(result)}`);
      for (const issue of result.issues) {
        deps.log.info(scope, `   ↳ [${issue.severity}] ${issue.dimension}${issue.blockId ? ` @${issue.blockId}` : ""}: ${issue.problem}`);
      }
      return saved;
    });
    logVerdict(deps, scope, evaluation.verdict, evaluation.totalScore, attempt);
    return;
  }

  // Reused evaluation: the page crashed between recording it and moving on; finish the move.
  await approvalLock.run(() =>
    deps.db.$transaction((tx) => applyVerdict(tx, page, evaluation.verdict, evaluation.totalScore, draftContent, entityNames)),
  );
  logVerdict(deps, scope, evaluation.verdict, evaluation.totalScore, attempt);
}

function logVerdict(deps: PipelineDeps, scope: string, verdict: string, score: number, attempt: number) {
  if (verdict === "PASS") deps.log.info(scope, `✔ APPROVED at ${score}/100 after ${attempt} revision(s)`);
  else if (verdict === "REVISE") deps.log.info(scope, `✘ REJECTED at ${score}/100 → routed back to the Drafting Agent`);
  else deps.log.warn(scope, `still ${score}/100 after ${MAX_REVISIONS} revisions → flagged NEEDS_HUMAN_REVIEW`);
}

async function applyVerdict(
  tx: DbTx,
  page: LoadedPage,
  verdict: "PASS" | "REVISE" | "HUMAN_REVIEW",
  score: number,
  draftContent: ReturnType<typeof DraftContentSchema.parse>,
  entityNames: readonly string[],
): Promise<void> {
  if (verdict === "PASS") {
    const prose = draftProse(draftContent);
    const contentHash = sha256(draftContent);
    await tx.page.update({
      where: { id: page.id },
      data: {
        status: "APPROVED",
        qaScore: score,
        title: draftContent.title,
        metaDescription: draftContent.metaDescription,
        content: toJson(draftContent),
        contentHash,
        minhash: toJson(minhash(shingles(comparisonTokens(prose, entityNames)))),
        wordCount: wordCount(prose),
        // Only a real content change moves the sitemap's lastmod.
        ...(page.contentHash === contentHash ? {} : { contentUpdatedAt: new Date() }),
      },
    });
    await tx.keyword.update({ where: { id: page.keywordId }, data: { status: "COMPLETED" } });
  } else if (verdict === "REVISE") {
    await tx.page.update({ where: { id: page.id }, data: { status: "REVISING", qaScore: score, revisionCount: page.revisionCount + 1 } });
  } else {
    await tx.page.update({ where: { id: page.id }, data: { status: "NEEDS_HUMAN_REVIEW", qaScore: score } });
  }
}

// ── Driver ───────────────────────────────────────────────────────────────────────

/**
 * Runs one page through the state machine until it reaches a terminal state or fails. Every stage
 * commits its result with the status change, so a crash resumes at the stage it interrupted.
 */
export async function processPage(deps: PipelineDeps, pageId: string): Promise<PageStatus | null> {
  if (!(await claim(deps, pageId))) return null;
  let slug = pageId;
  try {
    for (;;) {
      const page = await loadPage(deps, pageId);
      slug = page.slug;
      if (!isActive(page.status)) return page.status;
      await assertLease(deps, pageId);
      switch (page.status) {
        case "QUEUED":
          deps.log.info(`page ${slug}`, `claimed by ${deps.workerId} — "${page.keyword.phrase}" (${page.pageType}, priority ${page.keyword.priority})`);
          await deps.db.page.update({ where: { id: pageId }, data: { status: "EXTRACTING" } });
          break;
        case "EXTRACTING":
          await extract(deps, page);
          break;
        case "DRAFTING":
        case "REVISING":
          await draft(deps, page);
          break;
        case "IN_QA":
          await review(deps, page);
          break;
      }
    }
  } catch (error) {
    if (error instanceof LeaseLostError) {
      deps.log.warn(`page ${slug}`, "lease lost to another worker; stopping without writing");
      return null;
    }
    const page = await deps.db.page.findUniqueOrThrow({ where: { id: pageId }, select: { attempts: true } });
    const attempts = page.attempts + 1;
    const retry = isRetryable(error) && attempts < MAX_PAGE_ATTEMPTS;
    await deps.db.page.updateMany({
      where: { id: pageId, leaseOwner: deps.workerId },
      data: {
        attempts,
        lastError: describeError(error).slice(0, 1000),
        ...(retry ? { nextAttemptAt: new Date(Date.now() + RETRY_BASE_MS * 2 ** (attempts - 1)) } : { status: "FAILED" }),
      },
    });
    deps.log.warn(`page ${slug}`, retry ? `transient failure, will retry later: ${describeError(error)}` : `FAILED: ${describeError(error)}`);
    return retry ? null : "FAILED";
  } finally {
    await deps.db.page.updateMany({ where: { id: pageId, leaseOwner: deps.workerId }, data: { leaseOwner: null, leaseExpiresAt: null } });
  }
}

/** Processes every claimable page with at most `concurrency` pages in flight. */
export async function runWorker(deps: PipelineDeps, options: { concurrency: number }): Promise<number> {
  const picking = new Mutex();
  const taken = new Set<string>();
  let processed = 0;

  const next = () =>
    picking.run(async () => {
      const now = new Date();
      const page = await deps.db.page.findFirst({
        where: {
          id: { notIn: [...taken] },
          status: { in: ACTIVE },
          nextAttemptAt: { lte: now },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
        },
        orderBy: [{ keyword: { priority: "desc" } }, { createdAt: "asc" }],
        select: { id: true },
      });
      if (page) taken.add(page.id);
      return page?.id ?? null;
    });

  const runner = async () => {
    for (let pageId = await next(); pageId; pageId = await next()) {
      await processPage(deps, pageId);
      processed++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, runner));
  return processed;
}
