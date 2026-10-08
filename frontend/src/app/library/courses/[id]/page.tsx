"use client";
// vm_info: the videos of one collection.
import { LibraryView } from "@/components/library/LibraryView";

export default function CoursePage({ params }: { params: { id: string } }) {
  return <LibraryView scope={{ kind: "collection", id: params.id }} />;
}
