import { Suspense } from "react";
import Image from "next/image";
import { cacheLife } from "next/cache";
import "bootstrap-icons/font/bootstrap-icons.css";
import AppHeader from "./components/appHeader";
import SaveButton from "./components/saveButton";
import SectionHead from "./components/sectionHead";
import SiteFooter from "./components/siteFooter";
import royalsOutreachLogo from "./assets/logo.png";
import "./css/home.css";
import { getSchoolStats } from "@/actions/stats";
import { formatHours } from "@/lib/formatHours";

const STEPS = [
  { icon: "plus-circle", title: "Log Hours", body: "Enter the date, club, category and hours, or sign up for a club opportunity." },
  { icon: "person-check", title: "Get Reviewed", body: "Your club sponsor or outside coordinator approves or denies the request." },
  { icon: "envelope", title: "Get Notified", body: "You receive an email when the status of a request changes." },
  { icon: "graph-up", title: "Track Progress", body: "See totals and category goals, then export your volunteer portfolio." },
];

const WHY = [
  { value: "58%", text: "of admissions leaders say community service has a positive impact on acceptance." },
  { value: "53%", text: "say it is used as a tie breaker between equally qualified applicants." },
];

const STAT_LABELS = ["School Total", "Students Serving", "Clubs & Honor Societies", "This Month"];

export default function HomePage() {
  return (
    <div className="home">
      <AppHeader />

      <main>
        {/* Hero */}
        <section className="home-hero">
          <Image
            src={royalsOutreachLogo}
            alt="Royals Outreach"
            className="home-hero-logo"
            sizes="(max-width: 600px) 80vw, 483px"
            priority
          />
          <p className="home-hero-text">
            The home for service hours across every Royals club and honor society. Log hours, get them
            approved and track your goals.
          </p>
          <SaveButton variant="danger" size="lg" icon="box-arrow-in-right" href="/login" className="home-hero-button">
            Sign In
          </SaveButton>
        </section>

        {/* Stats */}
        <Suspense fallback={<StatTiles values={STAT_LABELS.map(() => "–")} />}>
          <SchoolStats />
        </Suspense>

        {/* How It Works */}
        <section id="how-it-works" className="home-section home-steps-section">
          <SectionHead>How It Works</SectionHead>
          <ol className="home-steps">
            {STEPS.map((step, i) => (
              <li key={step.title} className="home-step">
                <span className="home-step-icon" aria-hidden="true">
                  <i className={`bi bi-${step.icon}`} />
                </span>
                <h3 className="home-step-title">
                  {i + 1}. {step.title}
                </h3>
                <p className="home-step-body">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Why It Matters */}
        <section id="why-it-matters" className="home-why">
          <div>
            <h2 className="home-why-title">Service Hours Matter After Graduation</h2>
            <p className="home-why-text">
              In a 2018 survey of 264 admissions leaders, service experience carried weight in who gets accepted.
            </p>
            <p className="home-why-source">Newton, D. (2018). Forbes.</p>
          </div>
          <div className="home-why-facts">
            {WHY.map((fact) => (
              <div key={fact.value} className="home-why-fact">
                <span className="home-why-value">{fact.value}</span>
                <span className="home-why-fact-text">{fact.text}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Contact */}
        <section id="contact" className="home-section">
          <div className="home-contact">
            <div>
              <h2 className="home-contact-title">Need Help?</h2>
              <p className="home-contact-text">Contact your club sponsor, or reach the Royals Outreach team.</p>
            </div>
            <div className="home-contact-lines">
              {/* TODO: real contact details */}
              <span>
                <i className="bi bi-envelope" aria-hidden="true" /> [Contact email]
              </span>
              <span>
                <i className="bi bi-telephone" aria-hidden="true" /> [Contact phone]
              </span>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter linkLabel="Sign In" />
    </div>
  );
}

// Same numbers for every visitor, so they are cached and refreshed hourly
async function SchoolStats() {
  "use cache";
  cacheLife("hours");
  const stats = await getSchoolStats();

  return (
    <StatTiles
      values={[
        formatHours(stats.totalHours),
        stats.studentsServing.toLocaleString("en-US"),
        stats.clubs.toLocaleString("en-US"),
        formatHours(stats.hoursThisMonth),
      ]}
    />
  );
}

function StatTiles({ values }: { values: string[] }) {
  return (
    <div className="home-stats">
      {STAT_LABELS.map((label, i) => (
        <div key={label} className="home-stat">
          <div className="home-stat-value">{values[i]}</div>
          <div className="home-stat-label">{label}</div>
        </div>
      ))}
    </div>
  );
}
