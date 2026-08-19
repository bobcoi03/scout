import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { RepositoryLink } from "@/components/repository-link";
import styles from "./home.module.css";

export const metadata: Metadata = {
  title: "Scout — Curated from X",
  description: "A curated feed of launches, startups, and side projects from X.",
};

export default function HomePage() {
  return <main className={styles.page}>
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="Scout home">
        <span aria-hidden="true" className={styles.mark}><i /><i /><i /></span>
        <span>Scout</span>
      </Link>

      <nav aria-label="Primary navigation">
        <Link href="/table" className={styles.datasetLink}>Dataset</Link>
        <RepositoryLink className={styles.repositoryLink} />
      </nav>
    </header>

    <section className={styles.hero}>
      <h1>
        A curated feed of <em>launches, startups &amp; side projects</em> from{" "}
        <Image src="/x-logo.svg" alt="X" width={1200} height={1227} priority className={styles.xLogo} />
      </h1>
      <div className={styles.heroAction}>
        <p>Stop doomscrolling. Scout filters the noise so Index Ventures can spot emerging builders, launches and projects worth following.</p>
        <Link href="/product" className={styles.feedLink}>
          Open the feed <ArrowUpRight aria-hidden="true" />
        </Link>
      </div>
    </section>

    <footer className={styles.footer}>
      <span><i aria-hidden="true" /> Curated daily</span>
      <span>Scout · Signals from X</span>
    </footer>
  </main>;
}
