import { Hero } from "@/components/spark/Hero";
import { Features } from "@/components/spark/sections/Features";
import { HowItWorks } from "@/components/spark/sections/HowItWorks";
import { Testimonials } from "@/components/spark/sections/Testimonials";
import { Stats } from "@/components/spark/sections/Stats";
import { ContactFooter } from "@/components/spark/sections/ContactFooter";

export default function LandingPage() {
  return (
    <>
      <Hero />
      <Features />
      <HowItWorks />
      <Testimonials />
      <Stats />
      <ContactFooter />
    </>
  );
}
