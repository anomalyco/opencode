import { ScrollProgress } from "@/components/ScrollProgress"
import { TopNav } from "@/components/TopNav"
import { Hero } from "@/components/Hero"
import { SectionProblem } from "@/components/SectionProblem"
import { SectionTEE } from "@/components/SectionTEE"
import { SectionHarness } from "@/components/SectionHarness"
import { SectionCoding } from "@/components/SectionCoding"
import { SectionComparison } from "@/components/SectionComparison"
import { CTA } from "@/components/CTA"
import { Footer } from "@/components/Footer"

export default function Page() {
  return (
    <>
      <ScrollProgress />
      <TopNav />
      <main className="relative z-10">
        <Hero />
        <SectionProblem />
        <SectionTEE />
        <SectionHarness />
        <SectionCoding />
        <SectionComparison />
        <CTA />
      </main>
      <Footer />
    </>
  )
}
