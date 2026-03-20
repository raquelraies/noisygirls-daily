const https = require('https');
const http = require('http');
const { parseStringPromise } = require('xml2js');

const SOURCES = [
  // NEWS
  { name: 'The Guardian',      url: 'https://www.theguardian.com/uk/rss',                  cat: 'news' },
  { name: 'BBC News',          url: 'https://feeds.bbci.co.uk/news/rss.xml',               cat: 'news' },
  { name: 'Daily Mail',        url: 'https://www.dailymail.co.uk/articles.rss',            cat: 'news' },
  { name: 'The Economist',     url: 'https://www.economist.com/latest/rss.xml',            cat: 'news' },
  { name: 'Wall Street Journal', url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml',      cat: 'news' },
  { name: 'Tortoise Media',    url: 'https://www.tortoisemedia.com/feed/',                 cat: 'news' },
  { name: 'Prospect Magazine', url: 'https://www.prospectmagazine.co.uk/feed',             cat: 'news' },
  // CULTURE
  { name: 'Page Six',          url: 'https://pagesix.com/feed/',                           cat: 'culture' },
  { name: 'Vanity Fair',       url: 'https://www.vanityfair.com/feed/rss',                 cat: 'culture' },
  { name: 'New York Mag',      url: 'https://nymag.com/feed/all',                          cat: 'culture' },
  { name: 'The Atlantic',      url: 'https://feeds.feedburner.com/TheAtlantic',            cat: 'culture' },
  { name: 'The New Yorker',    url: 'https://www.newyorker.com/feed/everything',           cat: 'culture' },
  { name: '1843 Magazine',     url: 'https://www.economist.com/1843/rss.xml',              cat: 'culture' },
  { name: 'Longreads',         url: 'https://longreads.com/feed/',                         cat: 'culture' },
  { name: 'Dazed',             url: 'https://www.dazeddigital.com/rss',                    cat: 'culture' },
  // LIFESTYLE
  { name: 'The Cut',           url: 'https://www.thecut.com/rss/index.xml',                cat: 'lifestyle' },
  { name: 'Refinery29',        url: 'https://www.refinery29.com/en-gb/rss.xml',            cat: 'lifestyle' },
  { name: 'Wired',             url: 'https://www.wired.com/feed/rss',                      cat: 'lifestyle' },
  // FASHION
  { name: 'Vogue',             url: 'htt
