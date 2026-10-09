// ABOUTME: Canonical URLs stay on the production origin and drop every query string.
// ABOUTME: Filtered city, homepage, and leaderboard listings must not self-canonicalize.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHref } from '../src/lib/canonicalUrl.ts';
import { HOME_TITLE } from '../src/lib/pageTitles.ts';

test('filtered and paginated city lists canonicalize to /cities', () => {
  assert.equal(
    canonicalHref('/cities?sort=population&status=active&page=2'),
    'https://hallucinatingsplines.com/cities',
  );
  assert.equal(
    canonicalHref('/cities?utm_source=newsletter'),
    'https://hallucinatingsplines.com/cities',
  );
  assert.equal(canonicalHref('/cities'), 'https://hallucinatingsplines.com/cities');
});

test('other list pages drop sort, view, and page query params', () => {
  assert.equal(canonicalHref('/?sort=score#collection-title'), 'https://hallucinatingsplines.com/');
  assert.equal(
    canonicalHref('/leaderboard?view=mayors&page=3'),
    'https://hallucinatingsplines.com/leaderboard',
  );
});

test('detail pages keep their path and ignore stray query params', () => {
  assert.equal(
    canonicalHref('/cities/crystal-bay-a1b2c3?ref=earth'),
    'https://hallucinatingsplines.com/cities/crystal-bay-a1b2c3',
  );
  assert.equal(canonicalHref('/earth'), 'https://hallucinatingsplines.com/earth');
});

test('homepage title stays under 60 characters and keeps the brand and meaning', () => {
  assert.ok(HOME_TITLE.length < 60, `title is ${HOME_TITLE.length} characters: ${HOME_TITLE}`);
  assert.match(HOME_TITLE, /Hallucinating Splines/);
  assert.match(HOME_TITLE, /AI agents/);
  assert.match(HOME_TITLE, /SimCity/);
});
