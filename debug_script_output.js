(() => {
        try {
            const body = document.body;
            if (!body) return { error: 'No body' };
            
            // 1. Try to find the best container
            let target = document.querySelector('#conversation') || 
                         document.querySelector('#chat') || 
                         document.querySelector('#cascade') ||
                         document.querySelector('main') ||
                         document.querySelector('[role="main"]');

            // If we found a target, use it. Otherwise, use body but indicate it's a fallback
            const root = target || body;
            
            // 2. Capture CSS
            const rules = [];
            try {
                for (const sheet of document.styleSheets) {
                    try {
                        for (const rule of sheet.cssRules) {
                            rules.push(rule.cssText);
                        }
                    } catch (e) { }
                }
            } catch(e) {}
            const allCSS = rules.join('\\n');

            // 3. Calculate Scroll Info
            const scrollEl = root.querySelector('.overflow-y-auto, [data-scroll-area]') || root;
            const scrollInfo = {
                scrollTop: scrollEl.scrollTop || 0,
                scrollHeight: scrollEl.scrollHeight || 0,
                clientHeight: scrollEl.clientHeight || 0
            };

            // 4. Serialize & Clean HTML
            const isTruncated = !target;
            // --- 4. CLONE & CLEAN (Ported from original Antigravity for 'Clean' display) ---
            const clone = root.cloneNode(true);
            
            // A. Aggressively remove interaction/input areas
            const interactionSelectors = [
                '.relative.flex.flex-col.gap-8',
                '.flex.grow.flex-col.justify-start.gap-8',
                'div[class*="interaction-area"]',
                '[class*="bg-gray-500"]',
                '[class*="outline-solid"]',
                '[contenteditable="true"]',
                '[placeholder*="Ask anything"]',
                '.monaco-inputbox',
                '.quick-input-widget'
            ];

            interactionSelectors.forEach(selector => {
                try {
                    clone.querySelectorAll(selector).forEach(el => {
                        try {
                            // Only remove if it's REALLY an interaction area
                            // (Avoid removing message containers that might share these classes)
                            const isInputArea = el.querySelector('textarea, input, [contenteditable="true"]') || 
                                                el.getAttribute('placeholder')?.includes('Ask') ||
                                                el.innerText.includes('Ask anything');
                            
                            if (isInputArea || selector === '.monaco-inputbox' || selector === '.quick-input-widget') {
                                // Special handling for contenteditable: remove its container if possible
                                if (selector === '[contenteditable="true"]') {
                                    const area = el.closest('.relative.flex.flex-col.gap-8') || 
                                                 el.closest('.flex.grow.flex-col.justify-start.gap-8') ||
                                                 el.closest('div[id^="interaction"]') ||
                                                 el.parentElement?.parentElement;
                                    if (area && area !== clone) area.remove();
                                    else el.remove();
                                } else {
                                    el.remove();
                                }
                            }
                        } catch(e) {}
                    });
                } catch(e) {}
            });

            // B. Text-based cleanup for banners and status bars
            clone.querySelectorAll('*').forEach(el => {
                try {
                    const text = (el.innerText || '').toLowerCase();
                    if (text.includes('review changes') || text.includes('files with changes') || 
                        text.includes('context found') || text.includes('ask anything')) {
                        // If it's a small structural element or has interactive cues, nuke it
                        if (el.children.length < 15 || el.querySelector('button') || el.classList?.contains('justify-between')) {
                            el.remove();
                        }
                    }
                } catch (e) {}
            });

            // --- 5. Protocol Sanitization ---
            const badSchemes = ['vscode-file://', 'file://', 'app://', 'devtools://', 'vscode-webview-resource://'];
            const blankGif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
            
            const cleanText = (text) => {
                if (!text) return text;
                let out = text;
                
                // Path cleaning with verified escaping
                const brainPathRegex = new RegExp('[a-z]:[\\\\\\\\/]+(?:users)[\\\\\\\\/]+[^\\\\\\\\/]+[\\\\\\\\/]+\\\\\\.gemini[\\\\\\\\/]+antigravity[\\\\\\\\/]+brain[\\\\\\\\/]+', 'gi');
                out = out.replace(brainPathRegex, '/brain/');

                // Normalize backslashes (Wait, browser paths only have forward slashes after conversion)
                // But the ID part might still have backslashes if the above regex didn't catch everything
                out = out.replace(new RegExp('/brain/[^"\' >)]+', 'g'), (match) => {
                    return match.replace(/\\\\/g, '/');
                });
                
                // Rewrite other Windows paths (fallback)
                // const localFileRegex = /[A-Za-z]:[\\/][^"'\s<>]+/g; // Too aggressive, might break text
                
                if (out.includes('url(')) {
                    out = out.split('url(').map((part, i) => {
                        if (i === 0) return part;
                        const endIdx = part.indexOf(')');
                        const urlContent = part.substring(0, endIdx);
                        if (badSchemes.some(s => urlContent.includes(s))) {
                            return '"' + blankGif + '"' + part.substring(endIdx);
                        }
                        return part;
                    }).join('url(');
                }
                badSchemes.forEach(s => {
                    out = out.split(s).join('#');
                });
                return out;
            };

            clone.querySelectorAll('*').forEach(el => {
                for (let i = 0; i < el.attributes.length; i++) {
                    const attr = el.attributes[i];
                    // Check for bad schemes OR local brain paths
                    if (badSchemes.some(s => attr.value.includes(s)) || attr.value.includes('antigravity/brain')) {
                        el.setAttribute(attr.name, cleanText(attr.value));
                    }
                }
                if (el.tagName === 'STYLE') el.textContent = cleanText(el.textContent);
            });

            const cleanCSS = cleanText(allCSS);
            let cleanHTML = cleanText(clone.outerHTML);

            return {
                html: isTruncated ? cleanHTML.substring(0, 10000) : cleanHTML, 
                css: cleanCSS,
                scrollInfo: scrollInfo,
                foundTarget: !!target,
                title: document.title,
                url: window.location.href
            };
        } catch(e) { return { error: e.toString() }; }
    })()