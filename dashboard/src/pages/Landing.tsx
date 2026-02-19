import LandingNav from '@/components/landing/LandingNav';
import HeroSection from '@/components/landing/HeroSection';
import FeaturesSection from '@/components/landing/FeaturesSection';
import HowItWorksSection from '@/components/landing/HowItWorksSection';
import BetterTogetherSection from '@/components/landing/BetterTogetherSection';
import OpenSourceSection from '@/components/landing/OpenSourceSection';
import PricingSection from '@/components/landing/PricingSection';
import Footer from '@/components/landing/Footer';
import SEO, { LandingJsonLd } from '@/components/SEO';

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Epitome — Your AI Memory Vault"
        description="The portable identity layer that gives every AI agent a shared, persistent memory of you. Open source. Self-hostable. Yours."
        path="/"
      />
      <LandingJsonLd />
      <LandingNav />
      <HeroSection />
      <FeaturesSection />
      <HowItWorksSection />
      <BetterTogetherSection />
      <OpenSourceSection />
      <PricingSection />
      <Footer />
    </div>
  );
}
