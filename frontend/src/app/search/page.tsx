import { Navbar } from "@/components/layout/Navbar";
import { SearchInterface } from "@/components/search/SearchInterface";

export default function SearchPage() {
  return (
    <div className="min-h-screen gradient-mesh">
      <Navbar />
      <main className="pt-20 sm:pt-24 pb-16 px-4 sm:px-6 max-w-4xl mx-auto">
        <div className="mb-8 sm:mb-10 pt-4">
          <span className="px-3 py-1 rounded-full border border-volt/20 bg-volt/5 text-xs font-mono text-volt">
            Semantic Search
          </span>
          <h1 className="font-syne text-2xl sm:text-3xl font-800 text-white mt-3 leading-tight">
            Search by <span className="text-volt">meaning</span>,{" "}
            <span className="block sm:inline">not keywords</span>
          </h1>
          <p className="text-white/40 font-dm text-sm mt-3 max-w-lg leading-relaxed">
            Ask a question in natural language. VideoMind searches across all your
            videos and finds the exact moments that answer it.
          </p>
        </div>
        <SearchInterface />
      </main>
    </div>
  );
}
