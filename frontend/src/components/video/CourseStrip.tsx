"use client";
// vm_courses: where this video sits in its course, with the lessons either side.
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { VideoRecord } from "@/lib/api";
// vm_lang
import { useTranslations } from "next-intl";

export function CourseStrip({ course, base, owner }: {
  course: NonNullable<VideoRecord["course"]>;
  /** "/video" on the owner's page, "/v" on the shared page */
  base: "/video" | "/v";
  owner: boolean;
}) {
  const tc = useTranslations("courseStrip");
  return (
    <nav aria-label={tc("label")} className="flex items-center gap-3 flex-wrap rounded-md border border-rule bg-slate px-3.5 py-2.5">
      <span className="text-[13px] text-paper-2 min-w-0">
        <span className="tc me-2">{tc("lessonOf", { n: course.lesson, count: course.lessons })}</span>
        {owner
          ? <Link href={`/library/courses/${course.id}`} dir="auto" className="text-paper hover:underline">{course.name}</Link>
          : <span dir="auto" className="text-paper">{course.name}</span>}
      </span>
      <span className="ms-auto" />
      {course.prev && (
        <Link href={`${base}/${course.prev.id}`} className="inline-flex items-center gap-1 text-[13px] text-dim hover:text-paper max-w-[16rem]" title={course.prev.title}>
          <ChevronLeft size={13} className="shrink-0 rtl:rotate-180" /><span className="truncate">{tc("previous")}</span>
        </Link>
      )}
      {course.next && (
        <Link href={`${base}/${course.next.id}`} className="inline-flex items-center gap-1 text-[13px] text-paper hover:underline max-w-[18rem]" title={course.next.title}>
          <span className="truncate">{tc("next", { title: course.next.title })}</span><ChevronRight size={13} className="shrink-0 rtl:rotate-180" />
        </Link>
      )}
    </nav>
  );
}
