"use client";
import { use } from "react";
// vm_info: the videos of one collection.
import { LibraryView } from "@/components/library/LibraryView";

export default function CoursePage(props: { params: Promise<{ id: string }> }) {
  // vm_next15: params arrive as a promise in Next 15
  const params = use(props.params);
  return <LibraryView scope={{ kind: "collection", id: params.id }} />;
}
