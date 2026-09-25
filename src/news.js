const FEED_URL = "https://news.google.com/rss/search";

export async function searchNews(phrase, { limit = 5, days = 30 } = {}) {
  const params = new URLSearchParams({
    q: `${phrase} when:${days}d`,
    hl: "en-IN",
    gl: "IN",
    ceid: "IN:en",
  });
  const res = await fetch(`${FEED_URL}?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Google News returned ${res.status}`);
  const xml = await res.text();

  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .slice(0, limit)
    .map(([, item]) => {
      const source = tag(item, "source");
      let headline = tag(item, "title");
      if (source && headline.endsWith(` - ${source}`)) {
        headline = headline.slice(0, -(source.length + 3));
      }
      return { headline, source, date: formatDate(tag(item, "pubDate")), link: tag(item, "link") };
    })
    .filter((item) => item.headline && item.link);
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  if (!match) return "";
  return decodeEntities(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")).trim();
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

function formatDate(rfc822) {
  const date = new Date(rfc822);
  if (Number.isNaN(date.getTime())) return rfc822;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}
