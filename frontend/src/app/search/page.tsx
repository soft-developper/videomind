import { Navbar } from "@/components/layout/Navbar";
import { SearchInterface } from "@/components/search/SearchInterface";

export default function SearchPage() {
  return (
    <div className="min-h-screen bg-void">
      <Navbar />
      <main className="pt-14">
        <div className="border-b border-rule">
          <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-10">
            <p className="eyebrow mb-4">Search</p>
            <h1 className="font-display text-[32px] sm:text-[42px] leading-[1.05] text-paper max-w-lg">
              Ask for a moment.
              <br />
              <span className="italic text-signal">Get the timecode.</span>
            </h1>
            <p className="text-[14px] font-sans text-dim mt-4 max-w-md leading-relaxed">
              Search runs on meaning, not keywords. Describe what you half-remember
              and VideoMind finds where it was said.
            </p>
          </div>
        </div>

        <div className="max-w-[900px] mx-auto px-4 sm:px-6 py-8">
          <SearchInterface />
        </div>
      </main>
    </div>
  );
}
