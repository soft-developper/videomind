"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useSessionWallet } from "@/components/layout/AuthProvider";
import { getLearningPaths, regenerateLearningPaths, ApiError, type LearningPath } from "@/lib/api";
// vm_charge
import { PriceTag, AddCreditsLink, isNoCredits } from "@/components/credits/Credits";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { WalletButton } from "@/components/layout/WalletButton";
import { RefreshCw, ArrowRight } from "lucide-react";
import Link from "next/link";
import { clsx } from "clsx";
// vm_lang
import { useTranslations } from "next-intl";

/** The levels Claude gives a path, shown in the reader's language when known. */
const LEVELS = ["Beginner", "Intermediate", "Advanced"] as const;

export default function LearnPage() {
  const t = useTranslations("learn");
  const tcr = useTranslations("credits");
  const { connected } = useWallet();
  // vm_signin: data loads only once the wallet has signed in
  const wallet = useSessionWallet();
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["learning-paths", wallet],
    queryFn: () => getLearningPaths(wallet!),
    enabled: !!wallet && connected,
    staleTime: 60_000,
  });

  const regen = useMutation({
    mutationFn: () => regenerateLearningPaths(wallet!),
    onSuccess: (d) => { qc.setQueryData(["learning-paths", wallet], d); qc.invalidateQueries({ queryKey: ["my-credits"] }); },
  });
  const regenError = regen.error as ApiError | null;

  return (
    <AppShell>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <div className="section pb-16">
        <div className="max-w-[860px]">

          {!connected && (
            <EmptyState title={t("connect")} action={<WalletButton />}>
              {t("connectBody")}
            </EmptyState>
          )}

          {/* vm_signin: connected but not signed in */}
          {connected && !wallet && (
            <EmptyState title={t("signIn")}>
              {t("signInBody")}
            </EmptyState>
          )}

          {connected && isLoading && (
            <div className="space-y-4" aria-busy="true">
              <p className="text-[13.5px] text-dim">{t("reading")}</p>
              {[0, 1].map((i) => <div key={i} className="h-44 scan rounded-md" />)}
            </div>
          )}

          {connected && isError && (
            <EmptyState title={t("failed")}>
              {(error as Error)?.message}
            </EmptyState>
          )}

          {/* vm_charge: a paid build that did not work, with a way to add credits */}
          {regenError && (
            <p className="text-[13.5px] text-error mb-4" role="alert" data-learn-error>
              {regenError.message}{isNoCredits(regenError.code) && <> <AddCreditsLink /></>}
            </p>
          )}

          {/* vm_charge: paths cost credits, so they are made when asked for */}
          {connected && data && data.paths.length === 0 && data.needsBuild && !((data.minRequired ?? 0) > 0) && (
            <EmptyState
              title={tcr("pathsTitle")}
              action={
                <div className="flex flex-col items-start gap-2">
                  <button onClick={() => regen.mutate()} disabled={regen.isPending} className="btn btn-signal h-9 px-3.5" data-make-paths>
                    {regen.isPending ? t("building") : tcr("makePaths")}
                  </button>
                  <PriceTag what="paths" />
                </div>
              }
            >
              {tcr("pathsBody", { count: data.videoCount })}
            </EmptyState>
          )}

          {connected && data && data.paths.length === 0 && (data.minRequired ?? 0) > 0 && (
            <EmptyState
              title={t("notEnough")}
              action={<Link href="/upload" className="btn btn-signal h-9 px-3.5 inline-flex items-center">{t("uploadVideo")}</Link>}
            >
              {t("notEnoughBody", { count: data.videoCount, min: data.minRequired ?? 0 })}
            </EmptyState>
          )}

          {/* vm_shell: enough videos, but no path came back. Say so and offer another try. */}
          {connected && data && data.paths.length === 0 && !data.needsBuild && !((data.minRequired ?? 0) > 0) && (
            <EmptyState
              title={t("noneBuilt")}
              action={
                <button onClick={() => regen.mutate()} disabled={regen.isPending} className="btn btn-signal h-9 px-3.5">
                  {regen.isPending ? t("building") : t("buildAgainLong")}
                </button>
              }
            >
              {t("noneBuiltBody", { count: data.videoCount })}
            </EmptyState>
          )}

          {connected && data && data.paths.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between pb-3 border-b border-rule">
                <span className="text-[13.5px] text-paper-2">
                  {t("builtFrom", { count: data.videoCount })}
                </span>
                <button
                  onClick={() => regen.mutate()}
                  disabled={regen.isPending}
                  className="flex items-center gap-1.5 text-[13px] text-dim hover:text-paper transition-colors disabled:opacity-50 no-min"
                >
                  <RefreshCw size={12} className={clsx(regen.isPending && "animate-spin")} />
                  {regen.isPending ? t("building") : t("buildAgain")}
                </button>
              </div>

              {/* vm_charge: made for fewer videos than there are now; building again costs credits */}
              {(data.needsBuild || regen.isPending) && (
                <div className="-mt-3 space-y-1" data-paths-outdated>
                  {data.needsBuild && <p className="text-[13px] text-paper-2">{tcr("pathsOld")}</p>}
                  <PriceTag what="paths" />
                </div>
              )}
              {!data.needsBuild && <PriceTag what="paths" className="-mt-3" />}

              {data.paths.map((p, i) => <Path key={i} p={p} />)}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Path({ p }: { p: LearningPath }) {
  const t = useTranslations("learn");
  const level = (LEVELS as readonly string[]).includes(p.level) ? t(`level.${p.level as (typeof LEVELS)[number]}`) : p.level;
  return (
    <section className="panel">
      <header className="px-4 py-4 border-b border-rule">
        <div className="flex items-baseline justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow mb-1.5 text-dim">
              {level}
            </p>
            <h2 className="font-display text-[22px] text-paper leading-tight" dir="auto">
              {p.title}
            </h2>
            <p className="text-[13px] font-sans text-dim mt-1.5 leading-relaxed" dir="auto">
              {p.description}
            </p>
          </div>
          <span className="tc tabular-nums shrink-0">
            {t("steps", { count: p.steps.length })}
          </span>
        </div>
      </header>

      <div>
        {p.steps.map((s, i) => (
          <Link
            key={`${s.videoId}-${i}`}
            href={`/video/${s.videoId}`}
            className="flex items-start gap-4 px-4 py-3.5 border-b border-rule last:border-0 hover:bg-slate transition-colors group"
          >
            <span className="tc tabular-nums shrink-0 pt-1 group-hover:tc-signal transition-colors">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="w-px self-stretch bg-rule group-hover:bg-signal transition-colors shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block font-display text-[17px] text-paper leading-tight group-hover:text-signal transition-colors" dir="auto">
                {s.title}
              </span>
              <span className="block text-[12px] font-sans text-dim mt-1 leading-relaxed" dir="auto">
                {s.reason}
              </span>
            </span>
            <ArrowRight size={12} className="text-dim-2 group-hover:text-signal shrink-0 mt-1 transition-colors rtl:rotate-180" />
          </Link>
        ))}
      </div>
    </section>
  );
}
