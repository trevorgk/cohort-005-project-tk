import { useFetcher } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/admin.refunds";
import { getCurrentUserId } from "~/lib/session";
import { parseFormData } from "~/lib/validation";
import {
  RefundPayoutStatus,
  RefundStatus,
  LessonProgressStatus,
  UserRole,
  courses,
  enrollments,
  lessonProgress,
  lessons,
  modules,
  purchases,
  refunds,
  users,
} from "~/db/schema";
import { db } from "~/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { data, isRouteErrorResponse, Link } from "react-router";
import { formatPrice } from "~/lib/utils";

const refundActionSchema = z.object({
  intent: z.enum(["approve", "decline", "mark-issued", "mark-failed"]),
  refundId: z.coerce.number().int(),
});

async function requireAdmin(request: Request) {
  const currentUserId = await getCurrentUserId(request);

  if (!currentUserId) {
    throw data("Select a user from the DevUI panel to manage refunds.", {
      status: 401,
    });
  }

  const currentUser = db
    .select()
    .from(users)
    .where(eq(users.id, currentUserId))
    .get();

  if (!currentUser || currentUser.role !== UserRole.Admin) {
    throw data("Only admins can access this page.", { status: 403 });
  }

  return currentUser;
}

function getRefundRows(statuses: RefundStatus[]) {
  const rows = db
    .select({
      id: refunds.id,
      status: refunds.status,
      payoutStatus: refunds.payoutStatus,
      reason: refunds.reason,
      requestedAt: refunds.requestedAt,
      amountPaid: purchases.amountPaid,
      learnerId: users.id,
      learnerName: users.name,
      learnerEmail: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(refunds)
    .innerJoin(purchases, eq(refunds.purchaseId, purchases.id))
    .innerJoin(users, eq(purchases.userId, users.id))
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(inArray(refunds.status, statuses))
    .orderBy(refunds.requestedAt)
    .all();

  return rows.map((row) => {
    const lessonIds = db
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(eq(modules.courseId, row.courseId))
      .all()
      .map((l) => l.id);

    const completedLessons =
      lessonIds.length === 0
        ? 0
        : db
            .select({ count: sql<number>`count(distinct ${lessonProgress.lessonId})` })
            .from(lessonProgress)
            .where(
              and(
                eq(lessonProgress.userId, row.learnerId),
                eq(lessonProgress.status, LessonProgressStatus.Completed),
                inArray(lessonProgress.lessonId, lessonIds)
              )
            )
            .get()!.count;

    return { ...row, completedLessons, totalLessons: lessonIds.length };
  });
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  return {
    openRequests: getRefundRows([RefundStatus.Open]),
    approvedRequests: getRefundRows([RefundStatus.Approved]),
  };
}

export async function action({ request }: Route.ActionArgs) {
  const admin = await requireAdmin(request);

  const parsed = parseFormData(await request.formData(), refundActionSchema);

  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const { intent, refundId } = parsed.data;

  const refund = db.select().from(refunds).where(eq(refunds.id, refundId)).get();

  if (!refund) {
    throw data("Refund Request not found", { status: 404 });
  }

  if (intent === "approve" || intent === "decline") {
    if (refund.status !== RefundStatus.Open) {
      throw data("This Refund Request has already been decided.", {
        status: 409,
      });
    }

    const purchase = db
      .select()
      .from(purchases)
      .where(eq(purchases.id, refund.purchaseId))
      .get()!;

    db.transaction((tx) => {
      if (intent === "decline") {
        tx.update(refunds)
          .set({
            status: RefundStatus.Declined,
            resolvedAt: new Date().toISOString(),
            resolvedByUserId: admin.id,
          })
          .where(eq(refunds.id, refund.id))
          .run();
        return;
      }

      tx.update(refunds)
        .set({
          status: RefundStatus.Approved,
          amountRefunded: purchase.amountPaid,
          payoutStatus: RefundPayoutStatus.Pending,
          resolvedAt: new Date().toISOString(),
          resolvedByUserId: admin.id,
        })
        .where(eq(refunds.id, refund.id))
        .run();

      // Only the enrollment goes: lesson progress, ratings and watch history
      // stay, so the learner picks up where they left off if they buy again.
      tx.delete(enrollments)
        .where(
          and(
            eq(enrollments.userId, purchase.userId),
            eq(enrollments.courseId, purchase.courseId)
          )
        )
        .run();
    });

    return data({ ok: true });
  }

  if (
    refund.status !== RefundStatus.Approved ||
    refund.payoutStatus === RefundPayoutStatus.Issued
  ) {
    throw data("This Refund cannot be updated.", { status: 409 });
  }

  db.update(refunds)
    .set({
      payoutStatus:
        intent === "mark-issued"
          ? RefundPayoutStatus.Issued
          : RefundPayoutStatus.Failed,
    })
    .where(eq(refunds.id, refund.id))
    .run();

  return data({ ok: true });
}

type Row = Route.ComponentProps["loaderData"]["openRequests"][number];

function RefundActions({ row }: { row: Row }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";

  const button = (intent: string, label: string, variant?: "outline") => (
    <Button
      type="submit"
      name="intent"
      value={intent}
      variant={variant}
      size="sm"
      disabled={busy}
    >
      {label}
    </Button>
  );

  return (
    <fetcher.Form method="post" className="flex gap-2">
      <input type="hidden" name="refundId" value={row.id} />
      {row.status === RefundStatus.Open ? (
        <>
          {button("approve", "Approve")}
          {button("decline", "Decline", "outline")}
        </>
      ) : row.payoutStatus === RefundPayoutStatus.Issued ? null : (
        <>
          {button("mark-issued", "Mark issued")}
          {row.payoutStatus !== RefundPayoutStatus.Failed &&
            button("mark-failed", "Mark failed", "outline")}
        </>
      )}
    </fetcher.Form>
  );
}

function RefundCard({ row }: { row: Row }) {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              to={`/courses/${row.courseSlug}`}
              className="font-medium hover:underline"
            >
              {row.courseTitle}
            </Link>
            <p className="text-sm text-muted-foreground">
              {row.learnerName} ({row.learnerEmail}) ·{" "}
              {formatPrice(row.amountPaid)} · raised{" "}
              {new Date(row.requestedAt).toLocaleDateString()}
            </p>
          </div>
          <RefundActions row={row} />
        </div>
        <p className="text-sm">{row.reason}</p>
        <p className="text-sm text-muted-foreground">
          Progress: {row.completedLessons} of {row.totalLessons} lessons
          completed
          {row.payoutStatus ? ` · Refund ${row.payoutStatus}` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

export default function AdminRefunds({ loaderData }: Route.ComponentProps) {
  const { openRequests, approvedRequests } = loaderData;

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <div>
        <h1 className="text-2xl font-bold">Refund Requests</h1>
        <p className="text-sm text-muted-foreground">
          Approving refunds the full amount and removes the learner's access.
          Their progress is kept.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Open</h2>
        {openRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open Refund Requests.
          </p>
        ) : (
          openRequests.map((row) => <RefundCard key={row.id} row={row} />)
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Approved</h2>
        {approvedRequests.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No approved Refund Requests.
          </p>
        ) : (
          approvedRequests.map((row) => <RefundCard key={row.id} row={row} />)
        )}
      </section>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred while loading refunds.";

  if (isRouteErrorResponse(error)) {
    title = error.status === 403 ? "Access denied" : `Error ${error.status}`;
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
