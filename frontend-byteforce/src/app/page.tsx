import { Hero } from "@/components/home/Hero";
import { Manifesto } from "@/components/home/Manifesto";
import { Chapters } from "@/components/home/Chapters";
import { Capabilities } from "@/components/home/Capabilities";
import { LivePreview } from "@/components/home/LivePreview";
import { Limits, RouteBento, FinalCta } from "@/components/home/Closing";

export default function HomePage() {
  return (
    <>
      <Hero />
      <Manifesto />
      <Chapters />
      <Capabilities />
      <LivePreview />
      <Limits />
      <RouteBento />
      <FinalCta />
    </>
  );
}
