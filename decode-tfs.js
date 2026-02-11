#!/usr/bin/env node
/**
 * Decode tfs/tfu base64 protobuf from URL params.
 * The tfs payload is URL-safe base64 over binary (likely protobuf); see:
 * https://stackoverflow.com/questions/68959917/how-can-i-decode-recreate-google-flights-search-urls
 * To recreate search URLs without encoding tfs, use the "q" param instead, e.g.:
 *   https://www.google.com/travel/flights?q=Flights%20to%20SFO%20from%20HNL%20on%202022-09-13%20through%202022-09-17
 * Usage: node decode-tfs.js "<url_or_query_string>"
 */
const input = process.argv[2];
if (!input || !input.trim()) {
  console.error('Usage: node decode-tfs.js "<url_or_query_string>"');
  console.error('Pass the full URL or the query string (e.g. tfs=...&tfu=...) from the page.');
  process.exit(1);
}

// If input looks like a URL, take the query string (and hash) from it
function extractQueryString(urlOrQuery) {
  const s = urlOrQuery.trim();
  const q = s.indexOf('?');
  if (q >= 0) {
    const query = s.slice(q + 1);
    return query;
  }
  return s;
}

const QUERY_STRING = extractQueryString(input);

function getTfsAndTfu(queryStr) {
  const pairs = queryStr.split('&');
  let tfs = null;
  let tfu = null;
  for (const seg of pairs) {
    if (seg.startsWith('tfs=')) tfs = decodeURIComponent(seg.slice(4));
    else if (seg.startsWith('tfu=')) tfu = decodeURIComponent(seg.slice(4));
  }
  return { tfs, tfu };
}

/**
 * Extract flight details from a TFS base64 URL-safe param.
 * Decodes base64, then extracts airport codes (3 letters) and dates (YYYY-MM-DD).
 */
function extractFlightDetails(tfsParam) {
  try {
    const s = tfsParam.replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4;
    const padded = pad ? s + '===='.slice(0, 4 - pad) : s;
    const decodedString = Buffer.from(padded, 'base64').toString('binary');

    const airportMatches = decodedString.match(/[A-Z]{3}/g);
    const dateMatches = decodedString.match(/\d{4}-\d{2}-\d{2}/g);
    const airports = airportMatches ? [...new Set(airportMatches)] : [];
    const dates = dateMatches ? [...new Set(dateMatches)] : [];

    return {
      origin: airports[0] || 'Unknown',
      destination: airports.length > 1 ? airports[airports.length - 1] : airports[0] || 'Unknown',
      departureDate: dates[0] || 'Unknown',
      returnDate: dates[1] || 'Unknown',
      transitAirports: airports.length > 2 ? airports.slice(1, -1) : [],
      rawDecoded: decodedString
    };
  } catch (error) {
    console.error('Error decoding flight data:', error);
    return null;
  }
}

function decodeVarint(buf, offset) {
  let value = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length) {
    const b = buf[pos++];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: value >>> 0, next: pos };
    shift += 7;
    if (shift >= 35) return { value: 0, next: offset };
  }
  return { value: 0, next: buf.length };
}

function tryUtf8ToString(bytes) {
  try {
    return Buffer.from(bytes).toString('utf8');
  } catch (_) {
    return null;
  }
}

function decodeProtobufWire(buf, offset, limit) {
  offset = offset || 0;
  limit = limit != null ? limit : buf.length;
  const out = {};
  let pos = offset;
  while (pos < limit) {
    const tagRes = decodeVarint(buf, pos);
    if (tagRes.next <= pos) break;
    pos = tagRes.next;
    const tag = tagRes.value;
    const fieldNum = tag >>> 3;
    const wireType = tag & 7;
    const key = String(fieldNum);
    if (wireType === 0) {
      const vRes = decodeVarint(buf, pos);
      pos = vRes.next;
      out[key] = vRes.value;
    } else if (wireType === 1) {
      if (pos + 8 > limit) break;
      const low =
        (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)) >>> 0;
      const high =
        (buf[pos + 4] | (buf[pos + 5] << 8) | (buf[pos + 6] << 16) | (buf[pos + 7] << 24)) >>> 0;
      pos += 8;
      out[key] = '0x' + (high * 0x100000000 + low).toString(16);
    } else if (wireType === 2) {
      const lenRes = decodeVarint(buf, pos);
      pos = lenRes.next;
      const len = lenRes.value;
      if (pos + len > limit) break;
      const sub = buf.subarray ? buf.subarray(pos, pos + len) : buf.slice(pos, pos + len);
      pos += len;
      const asStr = tryUtf8ToString(sub);
      if (asStr !== null && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(asStr)) {
        out[key] = asStr;
      } else {
        out[key] = decodeProtobufWire(sub, 0, sub.length);
      }
    } else if (wireType === 5) {
      if (pos + 4 > limit) break;
      const fixed32 =
        (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)) >>> 0;
      pos += 4;
      out[key] = fixed32;
    } else {
      break;
    }
  }
  return out;
}

function extractReadableStrings(buf, offset, limit, acc) {
  const limit2 = limit != null ? limit : buf.length;
  let pos = offset || 0;
  while (pos < limit2) {
    const tagRes = decodeVarint(buf, pos);
    if (tagRes.next <= pos) break;
    pos = tagRes.next;
    const wireType = tagRes.value & 7;
    if (wireType === 0) {
      const vRes = decodeVarint(buf, pos);
      pos = vRes.next;
    } else if (wireType === 1) pos += 8;
    else if (wireType === 2) {
      const lenRes = decodeVarint(buf, pos);
      pos = lenRes.next;
      const len = lenRes.value;
      if (pos + len > limit2) break;
      const sub = buf.subarray ? buf.subarray(pos, pos + len) : buf.slice(pos, pos + len);
      pos += len;
      const s = tryUtf8ToString(sub);
      if (s && /^[\x20-\x7e\u00a0-\uffff]+$/.test(s) && s.length >= 2 && s.length <= 100) acc.push(s);
      else if (sub.length > 0 && sub[0] < 0x80) extractReadableStrings(sub, 0, sub.length, acc);
    } else if (wireType === 5) pos += 4;
    else break;
  }
  return acc;
}

function base64UrlToBuffer(s) {
  const raw = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = raw.length % 4;
  const padded = pad ? raw + '===='.slice(0, 4 - pad) : raw;
  return Buffer.from(padded, 'base64');
}

const { tfs, tfu } = getTfsAndTfu(QUERY_STRING);

if (tfs) {
  const flightData = extractFlightDetails(tfs);
  console.log('=== extractFlightDetails(tfs) ===');
  console.log(flightData ? JSON.stringify(flightData, null, 2) : 'null');
  console.log('');
}

if (tfs) {
  const buf = base64UrlToBuffer(tfs);
  const decoded = decodeProtobufWire(buf, 0, buf.length);
  const strings = extractReadableStrings(buf, 0, buf.length, []);
  console.log('=== TFS (raw param) ===');
  console.log(tfs);
  console.log('\n=== TFS decoded (field numbers = protobuf field ids) ===\n');
  console.log(JSON.stringify(decoded, null, 2));
  console.log('\n=== TFS human-readable strings ===\n');
  strings.forEach((s) => console.log('  ', s));
  console.log('');
}

if (tfu) {
  const buf = base64UrlToBuffer(tfu);
  const decoded = decodeProtobufWire(buf, 0, buf.length);
  const strings = extractReadableStrings(buf, 0, buf.length, []);
  console.log('=== TFU (raw param) ===');
  console.log(tfu);
  console.log('\n=== TFU decoded ===\n');
  console.log(JSON.stringify(decoded, null, 2));
  console.log('\n=== TFU human-readable strings ===\n');
  strings.forEach((s) => console.log('  ', s));
  console.log('');
}
