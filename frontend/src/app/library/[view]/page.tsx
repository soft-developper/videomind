"use client";
// vm_info: the library pages in the sidebar that list one kind of video:
// /library/lectures, /library/seminars, /library/presentations,
// /library/events and /library/live. See src/lib/categories.ts.
import { LibraryView } from "@/components/library/LibraryView";

export default function LibraryByCategory({ params }: { params: { view: string } }) {
  return <LibraryView scope={{ kind: "view", key: params.view }} />;
}
