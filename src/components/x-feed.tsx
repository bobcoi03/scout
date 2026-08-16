"use client";

import { ExternalLink, Heart, MessageCircle, Repeat2 } from "lucide-react";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

import type { FeedPost } from "@/db";

declare global {
  interface Window {
    twttr?: {
      widgets?: { load: (element?: HTMLElement) => void };
      events?: {
        bind: (name: string, handler: (event: { target: HTMLElement }) => void) => void;
        unbind: (name: string, handler: (event: { target: HTMLElement }) => void) => void;
      };
    };
  }
}

function compact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function shortDate(value: number) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(value);
}

export function XFeed({ posts }: { posts: FeedPost[] }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const preloadRef = useRef<HTMLImageElement[]>([]);
  const [activatedPosts, setActivatedPosts] = useState(() => new Set(posts.slice(0, 5).map((post) => post.id)));

  const hydrateEmbeds = () => {
    const feed = feedRef.current;
    if (!feed || !window.twttr?.widgets) return;
    const shells = [...feed.querySelectorAll<HTMLElement>(".tweet-shell:has(blockquote.twitter-tweet):not(:has(iframe))")];
    shells.forEach((shell) => window.twttr?.widgets?.load(shell));
  };

  useEffect(() => {
    const feed = feedRef.current;
    const revealShell = (shell: HTMLElement) => {
      if (shell.dataset.ready || shell.dataset.revealPending) return;
      shell.dataset.revealPending = "true";
      window.setTimeout(() => { shell.dataset.ready = "true"; }, 180);
    };
    const markWidgetReady = (event: { target: HTMLElement }) => {
      const shell = event.target.closest<HTMLElement>(".tweet-shell");
      const frame = shell?.querySelector<HTMLIFrameElement>(".twitter-tweet-rendered iframe[title='X Post']");
      if (shell && frame && frame.getBoundingClientRect().height > 100) revealShell(shell);
    };
    const readinessCheck = window.setInterval(() => {
      feed?.querySelectorAll<HTMLElement>(".tweet-shell:not([data-ready='true'])").forEach((shell) => {
        const frame = shell.querySelector<HTMLIFrameElement>(".twitter-tweet-rendered iframe[title='X Post']");
        if (frame && frame.getBoundingClientRect().height > 100) revealShell(shell);
      });
    }, 120);
    let eventsBound = false;
    const bindEvents = () => {
      if (eventsBound || !window.twttr?.events) return;
      window.twttr.events.bind("rendered", markWidgetReady);
      eventsBound = true;
    };

    bindEvents();
    const observer = feed && "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const postId = (entry.target as HTMLElement).dataset.postId;
        if (postId) setActivatedPosts((current) => current.has(postId) ? current : new Set(current).add(postId));
        observer?.unobserve(entry.target);
      }
    }, { root: feed, rootMargin: "100%" }) : null;
    feed?.querySelectorAll<HTMLElement>(".tweet-shell").forEach((shell) => observer?.observe(shell));

    const hydrationRetry = window.setInterval(() => {
      if (!window.twttr?.widgets) return;
      bindEvents();
      hydrateEmbeds();
      window.clearInterval(hydrationRetry);
    }, 250);
    hydrateEmbeds();

    preloadRef.current = posts.slice(0, 10).flatMap((post, index) => {
      if (!post.mediaUrl) return [];
      const media = new window.Image();
      media.decoding = "async";
      media.fetchPriority = index < 4 ? "high" : "auto";
      media.src = post.mediaUrl;
      return [media];
    });

    return () => {
      observer?.disconnect();
      window.clearInterval(hydrationRetry);
      window.clearInterval(readinessCheck);
      if (eventsBound) window.twttr?.events?.unbind("rendered", markWidgetReady);
      preloadRef.current = [];
    };
  }, [posts]);

  useEffect(() => { hydrateEmbeds(); }, [activatedPosts]);

  if (!posts.length) return null;

  return (
    <>
      <Script src="https://platform.twitter.com/widgets.js" strategy="afterInteractive" onLoad={hydrateEmbeds} onReady={hydrateEmbeds} />
      <div ref={feedRef} data-testid="x-feed" className="h-dvh overflow-y-auto overscroll-y-contain pt-[76px]">
        {posts.map((post, index) => (
          <article key={post.id} data-testid="feed-post" className="flex justify-center border-b border-[#181818]/18 px-4 py-10 sm:px-8 sm:py-14">
            <div className="w-full max-w-[650px]">
              <div className="mb-4 flex items-center justify-between gap-4 px-1">
                <span className="min-w-0 truncate text-xs text-[#181818]/45">@{post.username}</span>
                <span className="font-mono text-[10px] text-[#181818]/40">{String(index + 1).padStart(2, "0")} / {String(posts.length).padStart(2, "0")}</span>
              </div>

              <div className="tweet-shell w-full" data-post-id={post.id}>
                <div className="tweet-skeleton" role="status" aria-label="Loading X post">
                  <div className="tweet-skeleton-head"><span /><div><i /><i /></div></div>
                  <div className="tweet-skeleton-lines"><i /><i /><i /><i /></div>
                  <div className="tweet-skeleton-media" />
                  <span className="sr-only">Loading X post</span>
                </div>
                {activatedPosts.has(post.id) && <blockquote className="twitter-tweet" data-theme="light" data-link-color="#e42313" data-dnt="true" data-conversation="none">
                    <p lang="en" dir="ltr">{post.text}</p>
                    &mdash; {post.displayName ?? post.username} (@{post.username}) <a href={post.url}>{shortDate(post.publishedAt)}</a>
                  </blockquote>}
              </div>

              <div className="mt-4 flex items-center justify-between gap-4 px-2 text-[#181818]/50">
                <div className="flex items-center gap-5 text-xs">
                  <span className="inline-flex items-center gap-1.5"><Heart className="h-4 w-4" />{compact(post.likes)}</span>
                  <span className="inline-flex items-center gap-1.5"><Repeat2 className="h-4 w-4" />{compact(post.reposts)}</span>
                  <span className="inline-flex items-center gap-1.5"><MessageCircle className="h-4 w-4" />{compact(post.replies)}</span>
                </div>
                <a href={post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-[#e42313] transition hover:text-[#181818]">Open on X <ExternalLink className="h-3.5 w-3.5" /></a>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
