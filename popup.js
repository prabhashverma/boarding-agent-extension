// Extract page content as text. Passport & Visa dropdowns for context.

// --- Minimal protobuf wire-format decoder (no schema) ---
function decodeVarint(buf, offset) {
  var value = 0;
  var shift = 0;
  var pos = offset;
  while (pos < buf.length) {
    var b = buf[pos++];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: value >>> 0, next: pos };
    shift += 7;
    if (shift >= 35) return { value: 0, next: offset };
  }
  return { value: 0, next: buf.length };
}

function decodeProtobufWire(buf, offset, limit) {
  offset = offset || 0;
  limit = limit != null ? limit : buf.length;
  var out = {};
  var pos = offset;
  while (pos < limit) {
    var tagRes = decodeVarint(buf, pos);
    if (tagRes.next <= pos) break;
    pos = tagRes.next;
    var tag = tagRes.value;
    var fieldNum = tag >>> 3;
    var wireType = tag & 7;
    var key = String(fieldNum);
    if (wireType === 0) {
      var vRes = decodeVarint(buf, pos);
      pos = vRes.next;
      out[key] = vRes.value;
    } else if (wireType === 1) {
      if (pos + 8 > limit) break;
      var low = (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)) >>> 0;
      var high = (buf[pos + 4] | (buf[pos + 5] << 8) | (buf[pos + 6] << 16) | (buf[pos + 7] << 24)) >>> 0;
      pos += 8;
      out[key] = '0x' + (high * 0x100000000 + low).toString(16);
    } else if (wireType === 2) {
      var lenRes = decodeVarint(buf, pos);
      pos = lenRes.next;
      var len = lenRes.value;
      if (pos + len > limit) break;
      var sub = buf.subarray ? buf.subarray(pos, pos + len) : buf.slice(pos, pos + len);
      pos += len;
      var asStr = tryUtf8ToString(sub);
      var hasControlChars = asStr && /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(asStr);
      if (asStr !== null && !hasControlChars) {
        out[key] = asStr;
      } else {
        out[key] = decodeProtobufWire(sub, 0, sub.length);
      }
    } else if (wireType === 5) {
      if (pos + 4 > limit) break;
      var fixed32 = (buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24)) >>> 0;
      pos += 4;
      out[key] = fixed32;
    } else {
      break;
    }
  }
  return out;
}

function tryUtf8ToString(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (_) {
    return null;
  }
}

function base64UrlToBytes(base64Str) {
  var s = base64Str.replace(/-/g, '+').replace(/_/g, '/');
  var pad = s.length % 4;
  if (pad) s += '===='.slice(0, 4 - pad);
  var binary = atob(s);
  var arr = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return arr;
}

function getTfsAndTfuFromUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return { tfs: null, tfu: null };
  var tfs = null;
  var tfu = null;
  try {
    var q = urlStr.indexOf('?');
    var h = urlStr.indexOf('#');
    var queryStr = q >= 0 ? (h >= 0 && h > q ? urlStr.slice(q + 1, h) : urlStr.slice(q + 1)) : '';
    var hashStr = h >= 0 ? urlStr.slice(h + 1) : '';
    var combined = queryStr ? (hashStr ? queryStr + '&' + hashStr : queryStr) : hashStr;
    if (!combined) return { tfs: null, tfu: null };
    var pairs = combined.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var seg = pairs[i];
      if (seg.indexOf('tfs=') === 0) {
        var val = seg.slice(4);
        try { val = decodeURIComponent(val); } catch (_) {}
        tfs = val;
      } else if (seg.indexOf('tfu=') === 0) {
        var valTfu = seg.slice(4);
        try { valTfu = decodeURIComponent(valTfu); } catch (_) {}
        tfu = valTfu;
      }
    }
  } catch (_) {}
  return { tfs: tfs, tfu: tfu };
}

function getTfsParamFromUrl(urlStr) {
  return getTfsAndTfuFromUrl(urlStr).tfs;
}

function decodeGoogleFlightsString(tfsString) {
  try {
    var s = tfsString.replace(/-/g, '+').replace(/_/g, '/');
    var pad = s.length % 4;
    if (pad) s += '===='.slice(0, 4 - pad);
    var decoded = atob(s);
    var airportPattern = /[A-Z]{3}/g;
    var datePattern = /\d{4}-\d{2}-\d{2}/g;
    var airports = decoded.match(airportPattern);
    var dates = decoded.match(datePattern);
    var airportSet = airports ? Array.from(new Set(airports)) : [];
    var dateSet = dates ? Array.from(new Set(dates)) : [];
    var airline = '';
    var flightNumber = '';
    var twoLetter = decoded.match(/[A-Z]{2}/g);
    var numbers = decoded.match(/\d{3,5}/g);
    if (twoLetter && twoLetter.length) {
      var candidates = Array.from(new Set(twoLetter));
      for (var i = 0; i < candidates.length; i++) {
        if (airportSet.indexOf(candidates[i]) === -1) {
          airline = candidates[i];
          break;
        }
      }
    }
    if (numbers && numbers.length) {
      for (var n = 0; n < numbers.length; n++) {
        var num = numbers[n];
        var val = parseInt(num, 10);
        if (num.length <= 4 && (val < 1900 || val > 2100)) {
          flightNumber = num;
          break;
        }
      }
      if (!flightNumber) flightNumber = numbers[0];
    }
    return {
      origin: airportSet[0] || 'Unknown',
      destination: airportSet[1] || 'Unknown',
      departureDate: dateSet[0] || 'Unknown',
      returnDate: dateSet[1] || 'Unknown',
      airline: airline,
      flightNumber: flightNumber,
      raw: decoded
    };
  } catch (e) {
    console.error('Failed to decode flight string:', e);
    return null;
  }
}

function formatTfsHumanReadable(flightSummary, tfuPresent) {
  if (!flightSummary) return 'Could not decode flight summary.';
  var lines = [];
  lines.push('Outbound: ' + flightSummary.origin + ' \u2192 ' + flightSummary.destination + ' on ' + flightSummary.departureDate);
  lines.push('Return: ' + flightSummary.destination + ' \u2192 ' + flightSummary.origin + ' on ' + flightSummary.returnDate);
  if (flightSummary.airline || flightSummary.flightNumber) {
    var flight = [flightSummary.airline, flightSummary.flightNumber].filter(Boolean).join(' ');
    if (flight) lines.push('Flight: ' + flight);
  }
  if (tfuPresent) lines.push('(TFU token present)');
  return lines.join('\n');
}

/**
 * Build a Google Flights search URL using the natural-language "q" param.
 * Avoids needing to encode tfs; see https://stackoverflow.com/questions/68959917/how-can-i-decode-recreate-google-flights-search-urls
 * Round-trip: "Flights to DEST from ORIGIN on DEPARTURE through RETURN"
 * One-way: "Flights to DEST from ORIGIN on DATE oneway"
 */
function buildGoogleFlightsQueryUrl(flightSummary) {
  if (!flightSummary || !flightSummary.origin || !flightSummary.destination || !flightSummary.departureDate) return null;
  var base = 'https://www.google.com/travel/flights';
  var from = flightSummary.origin;
  var to = flightSummary.destination;
  var out = flightSummary.departureDate;
  var ret = flightSummary.returnDate;
  var q;
  if (ret && ret !== out && ret !== 'Unknown') {
    q = 'Flights to ' + to + ' from ' + from + ' on ' + out + ' through ' + ret;
  } else {
    q = 'Flights to ' + to + ' from ' + from + ' on ' + out + ' oneway';
  }
  return base + '?q=' + encodeURIComponent(q) + '&curr=USD';
}

document.addEventListener('DOMContentLoaded', function () {
  const addAsTextBtn = document.getElementById('addAsText');
  const useTestPayloadBtn = document.getElementById('useTestPayload');
  const useStructuredValidateTestBtn = document.getElementById('useStructuredValidateTest');
  const decodeTfsBtn = document.getElementById('decodeTfsBtn');
  const getAirlineBtn = document.getElementById('getAirlineBtn');
  const extractItineraryBtn = document.getElementById('extractItineraryBtn');
  const itinerarySection = document.getElementById('itinerarySection');
  const itineraryDecoded = document.getElementById('itineraryDecoded');
  const copyItineraryBtn = document.getElementById('copyItineraryBtn');
  const copyItineraryLabel = document.getElementById('copyItineraryLabel');
  const statusDiv = document.getElementById('status');
  const requestSection = document.getElementById('requestSection');
  const requestBody = document.getElementById('requestBody');
  const copyRequestBtn = document.getElementById('copyRequestBtn');
  const responseSection = document.getElementById('responseSection');
  const stepsContainer = document.getElementById('steps');
  const rawResponse = document.getElementById('rawResponse');
  const tfsSection = document.getElementById('tfsSection');
  const tfsDecoded = document.getElementById('tfsDecoded');
  const copyTfsBtn = document.getElementById('copyTfsBtn');
  const copyTfsLabel = document.getElementById('copyTfsLabel');
  const passportSelect = document.getElementById('passportCountry');
  const visaCountrySelect = document.getElementById('visaCountry');
  const visaTypeSelect = document.getElementById('visaType');
  const stepsById = new Map();

  var countries = window.COUNTRIES || [];
  var visaTypesByCountry = window.VISA_TYPES_BY_COUNTRY || {};

  // --- Populate Passport dropdown ---
  countries.forEach(function (name) {
    var opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    passportSelect.appendChild(opt);
  });

  // --- Populate Visa country dropdown (same list, sorted like passport) ---
  countries.forEach(function (name) {
    var opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    visaCountrySelect.appendChild(opt);
  });

  // --- Visa type depends on visa country ---
  visaCountrySelect.addEventListener('change', function () {
    var country = this.value;
    visaTypeSelect.innerHTML = '<option value="">Select visa type</option>';
    visaTypeSelect.disabled = !country;
    if (!country) return;
    var types = visaTypesByCountry[country];
    if (types && types.length) {
      types.forEach(function (type) {
        var opt = document.createElement('option');
        opt.value = type;
        opt.textContent = type;
        visaTypeSelect.appendChild(opt);
      });
    }
  });

  function showStatus(msg, type) {
    statusDiv.textContent = msg || '';
    statusDiv.style.color = type === 'error' ? '#dc2626' : type === 'success' ? '#059669' : '#6b7280';
  }

  function showResponse(text, isError) {
    responseSection.style.display = 'block';
    if (stepsContainer) stepsContainer.innerHTML = '';
    stepsById.clear();
    rawResponse.textContent = text || '(empty response)';
    rawResponse.classList.remove('error', 'success');
    rawResponse.classList.add(isError ? 'error' : 'success');
  }

  function clearStreamViews() {
    if (stepsContainer) stepsContainer.innerHTML = '';
    stepsById.clear();
    rawResponse.textContent = 'Receiving stream...';
    rawResponse.classList.remove('error', 'success');
    rawResponse.classList.add('success');
  }

  function formatPayloadForDisplay(payload) {
    if (!payload) return '';
    var asString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    var trimmed = asString.trim();
    if (!trimmed) return '';
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch (_) {
      return trimmed;
    }
  }

  function appendRaw(text) {
    if (!rawResponse) return;
    var wasPlaceholder = rawResponse.textContent === 'Receiving stream...';
    rawResponse.textContent = (wasPlaceholder ? '' : rawResponse.textContent + '\n\n') + text;
    rawResponse.scrollTop = rawResponse.scrollHeight;
  }

  function appendStreamEvent(eventName, payload) {
    var parsedPayload = payload;
    if (typeof payload === 'string') {
      try {
        parsedPayload = JSON.parse(payload);
      } catch (_) {
        parsedPayload = payload;
      }
    }

    if (eventName === 'thinking' && parsedPayload && typeof parsedPayload === 'object' && !Array.isArray(parsedPayload)) {
      var stepId = Object.prototype.hasOwnProperty.call(parsedPayload, 'step_id') ? parsedPayload.step_id : null;
      var message = parsedPayload.message || '';
      var details = parsedPayload.details && typeof parsedPayload.details === 'object' ? parsedPayload.details : null;

      if (stepId === null || stepId === undefined || stepId === '') {
        appendRaw('[thinking]\n' + (message || formatPayloadForDisplay(parsedPayload)));
        return;
      }

      var key = String(stepId);
      var stepEl = stepsById.get(key);
      if (!stepEl) {
        stepEl = document.createElement('div');
        stepEl.className = 'thinking-step';

        var titleEl = document.createElement('div');
        titleEl.className = 'thinking-title';

        var detailsEl = document.createElement('pre');
        detailsEl.className = 'thinking-details';

        stepEl.appendChild(titleEl);
        stepEl.appendChild(detailsEl);
        if (stepsContainer) stepsContainer.appendChild(stepEl);

        stepEl._titleEl = titleEl;
        stepEl._detailsEl = detailsEl;
        stepsById.set(key, stepEl);
      }

      stepEl._titleEl.textContent = message || '[thinking]';
      if (details && Object.keys(details).length > 0) {
        stepEl._detailsEl.textContent = JSON.stringify(details, null, 2);
        stepEl._detailsEl.style.display = 'block';
      } else {
        stepEl._detailsEl.textContent = '';
        stepEl._detailsEl.style.display = 'none';
      }

      if (stepsContainer) stepsContainer.scrollTop = stepsContainer.scrollHeight;
      return;
    }

    if (eventName === 'status' && parsedPayload && typeof parsedPayload === 'object') {
      var phaseMessage = parsedPayload.message || parsedPayload.phase || 'Processing…';
      if (stepsContainer) {
        var phaseEl = document.createElement('div');
        phaseEl.className = 'phase-step';
        phaseEl.innerHTML = '<span class="phase-icon" aria-hidden="true">▶</span><span class="phase-message">' + escapeHtml(phaseMessage) + '</span>';
        stepsContainer.appendChild(phaseEl);
        stepsContainer.scrollTop = stepsContainer.scrollHeight;
      }
      appendRaw('[' + eventName + ']\n' + formatPayloadForDisplay(parsedPayload));
      return;
    }

    if (eventName === 'leg_done' && parsedPayload && typeof parsedPayload === 'object') {
      var label = parsedPayload.label || 'Leg';
      var fromCache = parsedPayload.from_cache === true;
      if (stepsContainer) {
        var legEl = document.createElement('div');
        legEl.className = 'leg-done-step';
        legEl.innerHTML =
          '<span class="leg-done-label">' + escapeHtml(label) + ' complete</span>' +
          (fromCache ? '<span class="leg-done-badge">from cache</span>' : '');
        stepsContainer.appendChild(legEl);
        stepsContainer.scrollTop = stepsContainer.scrollHeight;
      }
      appendRaw('[' + eventName + ']\n' + formatPayloadForDisplay(parsedPayload));
      return;
    }

    if (eventName === 'done' && parsedPayload && typeof parsedPayload === 'object') {
      if (stepsContainer) {
        var doneEl = document.createElement('div');
        doneEl.className = 'done-step';
        doneEl.textContent = 'Validation complete.';
        stepsContainer.appendChild(doneEl);
        stepsContainer.scrollTop = stepsContainer.scrollHeight;
      }
      appendRaw('[' + eventName + ']\n' + formatPayloadForDisplay(parsedPayload));
      return;
    }

    appendRaw('[' + (eventName || 'message') + ']\n' + formatPayloadForDisplay(parsedPayload));
  }

  function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function showRequestJson(jsonStr) {
    requestSection.style.display = 'block';
    requestBody.textContent = jsonStr;
    requestBody.classList.remove('error', 'success');
    copyRequestBtn.onclick = function copyRequest() {
      navigator.clipboard.writeText(jsonStr).then(function () {
        var label = document.getElementById('copyRequestLabel');
        if (label) {
          copyRequestBtn.classList.add('copied');
          label.textContent = 'Copied!';
          setTimeout(function () {
            copyRequestBtn.classList.remove('copied');
            label.textContent = 'Copy';
          }, 2000);
        }
      });
    };
  }

  async function downloadRequestJson(jsonStr, pageTitle) {
    var baseTitle = (pageTitle || 'page').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
    var blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url: url,
      filename: baseTitle + '.json',
      saveAs: false
    });
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  async function sendPayloadToApi(jsonStr, pageTitle, apiUrlOverride) {
    showStatus('Sending to API...', '');
    responseSection.style.display = 'block';
    clearStreamViews();

    var apiUrl = apiUrlOverride || 'https://boarding-agent-api-production.up.railway.app/v1/checkmyflight?stream=true';
    var response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonStr
    });

    if (!response.ok) {
      var errText = await response.text();
      var displayErr = errText;
      try {
        displayErr = JSON.stringify(JSON.parse(errText), null, 2);
      } catch (_) {}
      showResponse(displayErr, true);
      showStatus('API error ' + response.status, 'error');
      return;
    }

    showStatus('Streaming...', '');
    var contentType = (response.headers.get('content-type') || '').toLowerCase();
    var useStrictSse = contentType.indexOf('text/event-stream') !== -1;
    var isJsonResponse = contentType.indexOf('application/json') !== -1;
    showStatus('Streaming (' + (useStrictSse ? 'SSE' : (isJsonResponse ? 'JSON response' : 'chunked text')) + ')...', '');

    if (!useStrictSse && isJsonResponse) {
      var responseText = await response.text();
      var displayText = responseText;
      try {
        var parsed = JSON.parse(responseText);
        displayText = JSON.stringify(parsed, null, 2);
      } catch (_) {}
      showResponse(displayText, false);
      showStatus('Response received (non-stream).', 'success');
      await downloadRequestJson(jsonStr, pageTitle);
      return;
    }

    var reader = response.body.getReader();
    var decoder = new TextDecoder();
    var sseBuffer = '';
    var streamClosedByServer = false;

    function processSseEvent(rawEventBlock) {
      if (!rawEventBlock) return;
      var lines = rawEventBlock.split('\n');
      var eventName = 'message';
      var dataParts = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (!line || line.charAt(0) === ':') continue;
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim() || 'message';
        } else if (line.startsWith('data:')) {
          dataParts.push(line.slice(5).trimStart());
        }
      }
      var dataText = dataParts.join('\n').trim();
      if (!dataText) return;
      if (dataText === '[DONE]' || eventName === 'done') {
        streamClosedByServer = true;
        return;
      }
      appendStreamEvent(eventName, dataText);
    }

    function processLooseLines(textChunk) {
      var lines = textChunk.split('\n');
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        if (line.startsWith('data:')) {
          var data = line.slice(5).trim();
          if (data && data !== '[DONE]') appendStreamEvent('message', data);
          if (data === '[DONE]') streamClosedByServer = true;
          continue;
        }
        if (line.startsWith('event:')) continue;
        if (line !== '[DONE]') appendStreamEvent('message', line);
        if (line === '[DONE]') streamClosedByServer = true;
      }
    }

    while (true) {
      var chunk = await reader.read();
      if (chunk.done) break;

      sseBuffer += decoder.decode(chunk.value, { stream: true }).replace(/\r/g, '');
      if (useStrictSse) {
        var boundary = sseBuffer.indexOf('\n\n');
        while (boundary !== -1) {
          var rawEvent = sseBuffer.slice(0, boundary).trim();
          sseBuffer = sseBuffer.slice(boundary + 2);
          processSseEvent(rawEvent);
          boundary = sseBuffer.indexOf('\n\n');
        }
      } else {
        var splitAt = sseBuffer.lastIndexOf('\n');
        if (splitAt !== -1) {
          var ready = sseBuffer.slice(0, splitAt + 1);
          sseBuffer = sseBuffer.slice(splitAt + 1);
          processLooseLines(ready);
        }
      }

      await new Promise(function (r) { requestAnimationFrame(r); });
    }

    var trailing = (sseBuffer || '').trim();
    if (trailing) {
      if (useStrictSse) processSseEvent(trailing);
      else processLooseLines(trailing + '\n');
    }

    if (rawResponse.textContent === 'Receiving stream...') {
      rawResponse.textContent = '(stream ended with no payload)';
    }

    showStatus(streamClosedByServer ? 'Stream complete.' : 'Stream ended.', 'success');
    await downloadRequestJson(jsonStr, pageTitle);
  }

  function extractPageContent(tabId) {
    return chrome.scripting.executeScript({
      target: { tabId },
      function: function () {
        return new Promise(function (resolve) {
          var modifiedGroups = [];
          try {
            [].slice.call(document.querySelectorAll('.group')).forEach(function (el) {
              var original = el.style.maxHeight;
              el.style.maxHeight = 'none';
              modifiedGroups.push({ el: el, original: original });
            });
          } catch (e) {}
          setTimeout(function () {
            try {
              var main = document.querySelector('main, article, [role="main"], .content');
              var root = main || document.body;
              var html = root.innerHTML;
              modifiedGroups.forEach(function (_) {
                try { _.el.style.maxHeight = _.original; } catch (e) {}
              });
              resolve({
                html: html,
                title: document.title,
                url: window.location.href,
                text: (root.innerText || root.textContent || '').trim()
              });
            } catch (err) {
              modifiedGroups.forEach(function (_) {
                try { _.el.style.maxHeight = _.original; } catch (e) {}
              });
              resolve({
                html: document.body.innerHTML,
                title: document.title,
                url: window.location.href,
                text: (document.body.innerText || document.body.textContent || '').trim()
              });
            }
          }, 500);
        });
      }
    }).then(function (results) {
      if (results && results[0] && results[0].result) return results[0].result;
      throw new Error('Could not extract page content');
    });
  }

  addAsTextBtn.addEventListener('click', async function () {
    addAsTextBtn.classList.add('is-loading');
    addAsTextBtn.disabled = true;
    showStatus('Extracting...');
    try {
      var tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab || !tab.id) throw new Error('No active tab');
      var pageData = await extractPageContent(tab.id);
      var text = pageData.text || (pageData.html ? pageData.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
      if (!text) throw new Error('No text content found on page');

      var payload = {
        passport: passportSelect.value || null,
        visa: {
          country: visaCountrySelect.value || null,
          visa_type: visaTypeSelect.value || null
        },
        flight_details: {
          title: pageData.title || '',
          url: pageData.url || '',
          extracted_text: text
        }
      };

      var jsonStr = JSON.stringify(payload, null, 2);
      showRequestJson(jsonStr);
      await sendPayloadToApi(jsonStr, pageData.title || 'page');
    } catch (e) {
      var errMsg = (e && e.message) || 'Failed';
      showStatus('Error: ' + errMsg, 'error');
      if (responseSection && rawResponse) {
        responseSection.style.display = 'block';
        rawResponse.textContent = errMsg;
        rawResponse.classList.remove('success');
        rawResponse.classList.add('error');
      }
    }
    addAsTextBtn.classList.remove('is-loading');
    addAsTextBtn.disabled = false;
  });

  if (useTestPayloadBtn) {
    useTestPayloadBtn.addEventListener('click', async function () {
      useTestPayloadBtn.classList.add('is-loading');
      useTestPayloadBtn.disabled = true;
      showStatus('Preparing test payload...');
      try {
        var ts = Date.now();
        var testPayload = {
          user_id: 'test_payload_' + ts,
          passengers: [
            { nationality: 'IN', visas: [] },
            { nationality: 'US', visas: [] }
          ],
          departing_segments: [
            {
              flight_number: 'UA989',
              airline: 'United',
              departure_airport: 'IAD',
              departure_time: '2026-03-09T18:15:00',
              arrival_airport: 'FRA',
              arrival_time: '2026-03-10T07:10:00'
            },
            {
              flight_number: 'LH756',
              airline: 'Lufthansa',
              departure_airport: 'FRA',
              departure_time: '2026-03-10T12:30:00',
              arrival_airport: 'BOM',
              arrival_time: '2026-03-11T01:05:00'
            }
          ],
          returning_segments: []
        };

        var payload = {
          passport: 'India',
          visa: { country: 'Germany', visa_type: 'Transit' },
          flight_details: {
            title: 'Test payload',
            url: 'https://example.com/test-payload',
            extracted_text: JSON.stringify(testPayload)
          }
        };

        var jsonStr = JSON.stringify(payload, null, 2);
        showRequestJson(jsonStr);
        await sendPayloadToApi(jsonStr, 'test-payload');
      } catch (e) {
        var errMsg = (e && e.message) || 'Failed';
        showStatus('Error: ' + errMsg, 'error');
        responseSection.style.display = 'block';
        rawResponse.textContent = errMsg;
        rawResponse.classList.remove('success');
        rawResponse.classList.add('error');
      }
      useTestPayloadBtn.classList.remove('is-loading');
      useTestPayloadBtn.disabled = false;
    });
  }

  if (useStructuredValidateTestBtn) {
    useStructuredValidateTestBtn.addEventListener('click', async function () {
      useStructuredValidateTestBtn.classList.add('is-loading');
      useStructuredValidateTestBtn.disabled = true;
      showStatus('Preparing validate structured test payload...');
      try {
        var ts = Date.now();
        var payload = {
          user_id: 'validate_test_' + ts,
          passengers: [
            { nationality: 'IN', visas: ['US_B1B2'] }
          ],
          departing_segments: [
            {
              flight_number: 'UA1245',
              airline: 'United',
              departure_airport: 'IAD',
              departure_time: '2026-03-11T06:00:00',
              arrival_airport: 'SJO',
              arrival_time: '2026-03-11T10:15:00'
            }
          ],
          returning_segments: [
            {
              flight_number: 'AV700',
              airline: 'Avianca',
              departure_airport: 'SJO',
              departure_time: '2026-03-19T09:35:00',
              arrival_airport: 'SAL',
              arrival_time: '2026-03-19T10:50:00'
            },
            {
              flight_number: 'AV701',
              airline: 'Avianca',
              departure_airport: 'SAL',
              departure_time: '2026-03-19T11:50:00',
              arrival_airport: 'IAD',
              arrival_time: '2026-03-19T17:55:00'
            }
          ]
        };

        var jsonStr = JSON.stringify(payload, null, 2);
        showRequestJson(jsonStr);
        await sendPayloadToApi(jsonStr, 'validate-structured-test');
      } catch (e) {
        var errMsg = (e && e.message) || 'Failed';
        showStatus('Error: ' + errMsg, 'error');
        responseSection.style.display = 'block';
        rawResponse.textContent = errMsg;
        rawResponse.classList.remove('success');
        rawResponse.classList.add('error');
      }
      useStructuredValidateTestBtn.classList.remove('is-loading');
      useStructuredValidateTestBtn.disabled = false;
    });
  }

  if (decodeTfsBtn) {
    decodeTfsBtn.addEventListener('click', async function () {
      decodeTfsBtn.classList.add('is-loading');
      decodeTfsBtn.disabled = true;
      showStatus('Reading URL and decoding TFS...');
      if (tfsSection) tfsSection.style.display = 'none';
      try {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        var tab = tabs && tabs[0];
        if (!tab || !tab.id) throw new Error('No active tab');
        var url = tab.url || '';
        try {
          var results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: function () { return window.location.href; }
          });
          if (results && results[0] && typeof results[0].result === 'string' && results[0].result.length > 0) {
            url = results[0].result;
          }
        } catch (_) {}
        if (!url) throw new Error('No URL available');
        var params = getTfsAndTfuFromUrl(url);
        var tfsRaw = params.tfs;
        var tfuRaw = params.tfu;
        if (!tfsRaw || !tfsRaw.trim()) throw new Error('No "tfs" parameter in this URL');
        var tfsTrimmed = tfsRaw.trim();
        var flightSummary = decodeGoogleFlightsString(tfsTrimmed);
        var humanReadable = formatTfsHumanReadable(flightSummary, !!(tfuRaw && tfuRaw.trim()));
        var searchUrl = buildGoogleFlightsQueryUrl(flightSummary);
        if (searchUrl) humanReadable += '\n\nSearch URL (q param, no tfs encode):\n' + searchUrl;
        var parts = [];
        parts.push('=== Human readable ===\n' + humanReadable);
        parts.push('=== Technical details ===\nComplete URL:\n' + url + '\n\nTFS (raw):\n' + tfsTrimmed);
        var bytes = base64UrlToBytes(tfsTrimmed);
        var decoded = decodeProtobufWire(bytes, 0, bytes.length);
        parts.push('TFS (protobuf):\n' + JSON.stringify(decoded, null, 2));
        if (tfuRaw && tfuRaw.trim()) {
          var tfuTrimmed = tfuRaw.trim();
          parts.push('\nTFU (raw):\n' + tfuTrimmed);
          try {
            var tfuBytes = base64UrlToBytes(tfuTrimmed);
            var tfuDecoded = decodeProtobufWire(tfuBytes, 0, tfuBytes.length);
            parts.push('TFU (protobuf):\n' + JSON.stringify(tfuDecoded, null, 2));
          } catch (e) {
            parts.push('TFU (protobuf): decode error - ' + (e && e.message ? e.message : 'unknown'));
          }
        }
        var fullOutput = parts.join('\n\n');
        tfsDecoded.textContent = fullOutput;
        tfsDecoded.classList.remove('error');
        tfsDecoded.classList.add('success');
        tfsSection.style.display = 'block';
        showStatus('TFS decoded. Flight summary + protobuf shown.', 'success');
        if (copyTfsBtn && copyTfsLabel) {
          copyTfsBtn.onclick = function () {
            navigator.clipboard.writeText(fullOutput).then(function () {
              copyTfsBtn.classList.add('copied');
              copyTfsLabel.textContent = 'Copied!';
              setTimeout(function () {
                copyTfsBtn.classList.remove('copied');
                copyTfsLabel.textContent = 'Copy';
              }, 2000);
            });
          };
        }
      } catch (e) {
        var errMsg = (e && e.message) || 'Decode failed';
        showStatus(errMsg, 'error');
        if (tfsSection && tfsDecoded) {
          tfsSection.style.display = 'block';
          tfsDecoded.textContent = errMsg;
          tfsDecoded.classList.remove('success');
          tfsDecoded.classList.add('error');
        }
      }
      decodeTfsBtn.classList.remove('is-loading');
      decodeTfsBtn.disabled = false;
    });
  }

  if (getAirlineBtn) {
    getAirlineBtn.addEventListener('click', async function () {
      getAirlineBtn.classList.add('is-loading');
      getAirlineBtn.disabled = true;
      showStatus('Getting airline from page...');
      try {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        var tab = tabs && tabs[0];
        if (!tab || !tab.id) throw new Error('No active tab');
        var results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function () {
            var el = document.querySelector('.s67o9c');
            return el ? el.innerText : null;
          }
        });
        var airline = results && results[0] && results[0].result != null ? results[0].result : null;
        if (airline && typeof airline === 'string' && airline.trim()) {
          showStatus('Airline: ' + airline.trim(), 'success');
        } else {
          showStatus('No airline found (no .s67o9c on page)', 'error');
        }
      } catch (e) {
        showStatus((e && e.message) || 'Failed to get airline', 'error');
      }
      getAirlineBtn.classList.remove('is-loading');
      getAirlineBtn.disabled = false;
    });
  }

  function extractOneCard(card) {
    var out = { summary: {}, legs: [], itineraryParam: null };
    var urlEl = card.querySelector('[data-travelimpactmodelwebsiteurl]');
    if (urlEl) {
      var url = urlEl.getAttribute('data-travelimpactmodelwebsiteurl');
      if (url) {
        var m = url.match(/itinerary=([^&]+)/);
        if (m) out.itineraryParam = decodeURIComponent(m[1]);
      }
    }
    var summaryLabel = card.querySelector('.mv1WYe[aria-label]');
    if (summaryLabel) out.summary.ariaLabel = summaryLabel.getAttribute('aria-label');
    var sSHqwe = card.querySelectorAll('.sSHqwe');
    var airlineLines = [];
    for (var i = 0; i < sSHqwe.length; i++) {
      var t = (sSHqwe[i].innerText || '').trim();
      if (t && t.indexOf('Operated by') === -1) airlineLines.push(t);
    }
    if (airlineLines.length) out.summary.airlines = airlineLines;
    var durationEl = card.querySelector('.gvkrdb');
    if (durationEl) out.summary.duration = (durationEl.innerText || '').trim();
    var routeEl = card.querySelector('.PTuQse');
    if (routeEl) out.summary.route = (routeEl.innerText || '').trim();
    var stopsEl = card.querySelector('.EfT7Ae .ogfYpf');
    if (stopsEl) out.summary.stops = (stopsEl.innerText || '').trim();
    var co2El = card.querySelector('.AdWm1c.lc3qH');
    if (co2El) out.summary.co2 = (co2El.innerText || '').trim();
    var legEls = card.querySelectorAll('[jsname="lVbzR"]');
    for (var k = 0; k < legEls.length; k++) {
      var leg = legEls[k];
      var legOut = {};
      var depTime = leg.querySelector('.b0EVyb');
      var arrTime = leg.querySelector('.OJg28c');
      var depAirport = leg.querySelector('.ZHa2lc');
      var arrAirport = leg.querySelector('.FY5t7d');
      var travelTime = leg.querySelector('.P102Lb');
      var layover = leg.querySelector('.tvtJdb');
      var airlineBlock = leg.querySelector('.MX5RWe');
      if (depTime) legOut.departureTime = (depTime.innerText || '').trim();
      if (arrTime) legOut.arrivalTime = (arrTime.innerText || '').trim();
      if (depAirport) legOut.origin = (depAirport.innerText || '').trim();
      if (arrAirport) legOut.destination = (arrAirport.innerText || '').trim();
      if (travelTime) legOut.travelTime = (travelTime.innerText || '').trim();
      if (layover) legOut.layover = (layover.innerText || '').trim();
      if (airlineBlock) {
        var xs = airlineBlock.querySelectorAll('.Xsgmwe');
        var name = '';
        var flightNum = '';
        for (var j = 0; j < xs.length; j++) {
          var p = (xs[j].innerText || '').trim();
          if (/^[A-Z]{2}\s*\d+$/i.test(p)) flightNum = p; else if (p && p.length < 30) name = name ? name + ' ' + p : p;
        }
        if (name) legOut.airline = name;
        if (flightNum) legOut.flightNumber = flightNum;
      }
      out.legs.push(legOut);
    }
    return out;
  }

  function extractItineraryInPage() {
    var cards = document.querySelectorAll('div[jsname="lwc3Jf"]');
    if (!cards.length) return null;
    var result = { departing: null, returning: null };
    for (var c = 0; c < cards.length; c++) {
      var card = cards[c];
      var listItem = card.closest('div[role="listitem"]');
      var isReturning = listItem && (listItem.textContent || '').indexOf('Returning flight') !== -1;
      var extracted = extractOneCard(card);
      if (isReturning) result.returning = extracted; else result.departing = extracted;
    }
    if (!result.departing && !result.returning) return null;
    return result;
  }

  if (extractItineraryBtn) {
    extractItineraryBtn.addEventListener('click', async function () {
      extractItineraryBtn.classList.add('is-loading');
      extractItineraryBtn.disabled = true;
      showStatus('Extracting itinerary from page...');
      if (itinerarySection) itinerarySection.style.display = 'none';
      try {
        var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        var tab = tabs && tabs[0];
        if (!tab || !tab.id) throw new Error('No active tab');
        var results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: extractItineraryInPage
        });
        var data = results && results[0] && results[0].result != null ? results[0].result : null;
        if (!data) {
          showStatus('No itinerary card found (open a Google Flights result with details)', 'error');
          if (itinerarySection && itineraryDecoded) {
            itinerarySection.style.display = 'block';
            itineraryDecoded.textContent = 'No flight card found. Make sure the page shows a Google Flights result and the flight details are visible (e.g. expanded).';
            itineraryDecoded.classList.add('error');
          }
        } else {
          var parts = [];
          if (data.departing) {
            parts.push('=== Departing ===');
            parts.push('Summary: ' + JSON.stringify(data.departing.summary, null, 2));
            parts.push('Legs: ' + JSON.stringify(data.departing.legs, null, 2));
            if (data.departing.itineraryParam) parts.push('Itinerary: ' + data.departing.itineraryParam);
            parts.push('');
          }
          if (data.returning) {
            parts.push('=== Returning ===');
            parts.push('Summary: ' + JSON.stringify(data.returning.summary, null, 2));
            parts.push('Legs: ' + JSON.stringify(data.returning.legs, null, 2));
            if (data.returning.itineraryParam) parts.push('Itinerary: ' + data.returning.itineraryParam);
            parts.push('');
          }
          var text = parts.join('\n').trim();
          itineraryDecoded.textContent = text;
          itineraryDecoded.classList.remove('error');
          itineraryDecoded.classList.add('success');
          itinerarySection.style.display = 'block';
          showStatus('Itinerary extracted.', 'success');
          if (copyItineraryBtn && copyItineraryLabel) {
            copyItineraryBtn.onclick = function () {
              navigator.clipboard.writeText(text).then(function () {
                copyItineraryBtn.classList.add('copied');
                copyItineraryLabel.textContent = 'Copied!';
                setTimeout(function () {
                  copyItineraryBtn.classList.remove('copied');
                  copyItineraryLabel.textContent = 'Copy';
                }, 2000);
              });
            };
          }
        }
      } catch (e) {
        showStatus((e && e.message) || 'Extract failed', 'error');
        if (itinerarySection && itineraryDecoded) {
          itinerarySection.style.display = 'block';
          itineraryDecoded.textContent = (e && e.message) || 'Extract failed';
          itineraryDecoded.classList.remove('success');
          itineraryDecoded.classList.add('error');
        }
      }
      extractItineraryBtn.classList.remove('is-loading');
      extractItineraryBtn.disabled = false;
    });
  }
});
