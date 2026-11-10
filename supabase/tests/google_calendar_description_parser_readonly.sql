-- Read-only parser check; safe on an existing database.
with source as (
  select replace('Plain https://example.org/doc. <a href="https://example.org/search?a=1&amp;b=2">link</a> <a href="https://example.org/?token=x!">https://example.org/?token=x!</a>', '&amp;', '&') as body
), anchor_urls as (
  select match[1] as candidate from source,
    regexp_matches(body, $href$href[[:space:]]*=[[:space:]]*["'](https?://[^"']+)["']$href$, 'gi') as match
), plain_urls as (
  select match[1] as raw_url from source,
    regexp_matches(regexp_replace(body, '<[^>]*>', ' ', 'g'), $url$(https?://[^[:space:]<>"']+)$url$, 'gi') as match
), found as (
  select candidate from anchor_urls
  union
  select case when exists(select 1 from anchor_urls a where a.candidate = p.raw_url)
    then p.raw_url else rtrim(p.raw_url, '.,;:!') end from plain_urls p
)
select array_agg(distinct candidate order by candidate) as urls from found where length(candidate) between 1 and 2048;
