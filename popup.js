// Extract page content as text. Passport & Visa dropdowns for context.

document.addEventListener('DOMContentLoaded', function () {
  const addAsTextBtn = document.getElementById('addAsText');
  const useTestPayloadBtn = document.getElementById('useTestPayload');
  const useStructuredValidateTestBtn = document.getElementById('useStructuredValidateTest');
  const statusDiv = document.getElementById('status');
  const requestSection = document.getElementById('requestSection');
  const requestBody = document.getElementById('requestBody');
  const copyRequestBtn = document.getElementById('copyRequestBtn');
  const responseSection = document.getElementById('responseSection');
  const stepsContainer = document.getElementById('steps');
  const rawResponse = document.getElementById('rawResponse');
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

    var apiUrl = apiUrlOverride || 'https://boarding-agent-api-production.up.railway.app/v1/validate-google-flight?stream=true';
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
        await sendPayloadToApi(
          jsonStr,
          'validate-structured-test',
          'https://boarding-agent-api-production.up.railway.app/v1/validate?stream=true'
        );
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
});
