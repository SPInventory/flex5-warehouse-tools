// ==UserScript==
// @name         Flex5 Scan Assistant (1.0.8)
// @namespace    http://tampermonkey.net/
// @version      1.0.8
// @description  Enhances Flex5 scanning with strict Line Lock and seamless Auto-Sub capabilities. Features UI highlighting, focus trapping, and role-based manager access.
// @author       Ethan Bell
// @match        *://streamlineprod.flexrentalsolutions.com/*
// @updateURL    https://raw.githubusercontent.com/SPInventory/flex5-warehouse-tools/refs/heads/main/flex5-lock.user.js
// @downloadURL  https://raw.githubusercontent.com/SPInventory/flex5-warehouse-tools/refs/heads/main/flex5-lock.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* global Ext */

(function() {
    'use strict';

    const AUTHORIZED_HASHES = [
        "RXRoYW4gQmVsbF9fRkxFWDVfU0VDUkVUX18=",             // Ethan Bell
        "TW9yZ2FuIEhpZ2dpbmJvdGhhbV9fRkxFWDVfU0VDUkVUX18=", // Morgan Higginbotham
        "R2FiZSBHaWJzb25fX0ZMRVg1X1NFQ1JFVF9f",             // Gabe Gibson
        "RnJlZCBIYWxsX19GTEVYNV9TRUNSRVRfXw==",             // Fred Hall
        "QWxleCBKYXluZXNfX0ZMRVg1X1NFQ1JFVF9f",             // Alex Jaynes
        "WkFuZSBGcmVlX19GTEVYNV9TRUNSRVRfXw==",             // Zane Free
        "SnVzdGluIFJpY2VfX0ZMRVg1X1NFQ1JFVF9f",             // Justin Rice
        "TWl0Y2hlbGwgQmFiZXJfX0ZMRVg1X1NFQ1JFVF9f",         // Mitchell Baber
        "Qm8gTWVyZGFub3ZpY19fRkxFWDVfU0VDUkVUX18="          // Bo Merdanovic
    ];

    const SECRET_SALT = "__FLEX5_SECRET__";

    let flexState = {
        mode: 'OFF',
        type: null,
        lockedLineId: null,
        lastInterceptedId: null,
        wantsArming: false,
        isAuthorizedManager: false
    };

    // --- 1. CSS ---
    const style = document.createElement('style');
    style.innerHTML = `
        .flex-locked-row-pink, .flex-locked-row-pink .x-grid-cell {
            background-color: rgb(250, 224, 223) !important;
        }
        .flex-locked-row-pink .x-grid-cell-inner {
            color: rgb(229, 57, 53) !important;
            font-weight: bold !important;
        }
        .flex-search-locked {
            background-color: rgb(250, 224, 223) !important;
            color: rgb(229, 57, 53) !important;
            font-weight: bold !important;
            text-align: center !important;
            border: 1px solid rgb(229, 57, 53) !important;
            cursor: pointer !important;
        }
        .flex-search-locked ~ .x-form-trigger-wrap {
            display: none !important;
        }
    `;
    document.head.appendChild(style);

    // --- 2. BOOT ---
    let initTimer = setInterval(() => {
        verifyManagerStatus();
        if (typeof Ext !== 'undefined' && Ext.ClassManager && Ext.ClassManager.get('ExtFlex.warehouse.equipmentlist.EquipmentListScanVC')) {
            clearInterval(initTimer);
            hijackMenu();
            hijackActivation();
            hookExtAjax();
            startGlobalWatchdog();
        }
    }, 500);

    function verifyManagerStatus() {
        if (flexState.isAuthorizedManager) return;
        try {
            const allTextElements = document.querySelectorAll('.x-btn-inner, .x-component');
            for (let el of allTextElements) {
                const rawName = el.innerText.trim();
                if (!rawName) continue;
                const encodedName = btoa(unescape(encodeURIComponent(rawName + SECRET_SALT)));
                if (AUTHORIZED_HASHES.includes(encodedName)) {
                    flexState.isAuthorizedManager = true;
                    return;
                }
            }
        } catch(e) {}
    }

    function getActiveSearchBar() {
        const scanContainers = document.querySelectorAll('div[id^="equipment-list-scan"]');
        for (let container of scanContainers) {
            if (container.offsetParent !== null) {
                const searchBox = container.querySelector('input[id$="-inputEl"][name*="search-field"]');
                if (searchBox) return searchBox;
            }
        }
        return null;
    }

    // --- 3. UI WATCHDOG ---
    function startGlobalWatchdog() {
        setInterval(() => {
            const inputEl = getActiveSearchBar();

            if (flexState.mode === 'LOCKED') {
                const row = document.querySelector(`[data-recordid="${flexState.lockedLineId}"]`);
                if (row && !row.classList.contains('flex-locked-row-pink')) {
                    row.classList.add('flex-locked-row-pink');
                }

                if (inputEl) {
                    inputEl.readOnly = true;
                    inputEl.value = flexState.type === 'LINE_LOCK' ? "LINE LOCK ACTIVE" : "AUTO-SUB ACTIVE";

                    if (!inputEl.classList.contains('flex-search-locked')) {
                        inputEl.classList.add('flex-search-locked');
                    }

                    if (!inputEl.hasAttribute('data-flex-hooked')) {
                        inputEl.setAttribute('data-flex-hooked', 'true');
                        inputEl.addEventListener('click', function(e) {
                            if (flexState.mode === 'LOCKED') {
                                e.preventDefault();
                                e.stopPropagation();
                                cancelLock();
                            }
                        });
                    }
                }

                if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
                    document.activeElement.blur();
                }
            } else {
                if (inputEl && inputEl.classList.contains('flex-search-locked')) {
                    inputEl.readOnly = false;
                    inputEl.classList.remove('flex-search-locked');
                    inputEl.removeAttribute('data-flex-hooked');
                    inputEl.value = "";
                    inputEl.placeholder = "Search...";
                }
                document.querySelectorAll('.flex-locked-row-pink').forEach(r => r.classList.remove('flex-locked-row-pink'));
            }
        }, 200);
    }

    function cancelLock() {
        flexState.mode = 'OFF';
        flexState.type = null;
        flexState.lockedLineId = null;
        flexState.wantsArming = false;

        const inputEl = getActiveSearchBar();
        if (inputEl) {
            inputEl.classList.remove('flex-search-locked');
            inputEl.value = "";
        }

        try {
            const nativeCancel = document.querySelector('.x-btn-icon-el-default-toolbar-small.fa-ban');
            if (nativeCancel) {
                nativeCancel.closest('.x-btn').click();
            }
        } catch (err) {}
    }

    // --- 4. CORE LOGIC ---
    function hijackMenu() {
        const origAdd = Ext.menu.Menu.prototype.add;
        Ext.menu.Menu.prototype.add = function() {
            const addedItems = origAdd.apply(this, arguments);
            try {
                const subBtn = this.down('menuitem[text*="Substitute Line"]');
                if (!subBtn || this.down('[itemId=lineLockBtn]')) return addedItems;

                // Get the ID immediately from the record attached to the menu
                const record = this.config?.record || this.rec;
                const recordId = record ? (record.get('id') || record.id) : null;

                this.insert(this.items.indexOf(subBtn) + 1, Ext.create('Ext.menu.Item', {
                    itemId: 'lineLockBtn', text: 'Line Lock', iconCls: 'x-fa fa-lock',
                    handler: function() { arm('LINE_LOCK', recordId, subBtn); }
                }));

                if (flexState.isAuthorizedManager) {
                    this.insert(this.items.indexOf(subBtn) + 2, Ext.create('Ext.menu.Item', {
                        itemId: 'autoSubLockBtn', text: 'Auto-Sub', iconCls: 'x-fa fa-retweet',
                        handler: function() { arm('AUTO_SUB', recordId, subBtn); }
                    }));
                }
            } catch (err) {}
            return addedItems;
        };
    }

    function arm(type, recordId, subBtn) {
        // Use intercepted ID if available for precision, otherwise fallback to menu record ID
        flexState.type = type;
        flexState.lockedLineId = flexState.lastInterceptedId || recordId;

        if (type === 'AUTO_SUB') {
            flexState.wantsArming = true;
            if (subBtn.handler) subBtn.handler.call(subBtn.scope || subBtn, subBtn);
        } else {
            flexState.mode = 'LOCKED';
        }
    }

    function hookExtAjax() {
        const originalRequest = Ext.Ajax.request;
        Ext.Ajax.request = function(options) {
            // Sniff the line ID when gear menu opens
            if (options.url?.includes('/additional-action-info')) {
                const match = options.url.match(/\/line-item\/([a-f0-9-]+)\/additional-action-info/);
                if (match && match[1]) flexState.lastInterceptedId = match[1];
            }

            // Intercept Scans
            if (options.url?.includes('/api/warehouse/scan') && options.jsonData) {
                const data = options.jsonData;

                if (flexState.mode === 'LOCKED' || flexState.wantsArming) {
                    if (flexState.type === 'AUTO_SUB' && flexState.isAuthorizedManager) {
                        // Silent Sub Rewrite
                        data.scanLineItemId = null; // Forces server to ignore current selection
                        data.substituteLineId = flexState.lockedLineId;

                        if (flexState.wantsArming) {
                            flexState.mode = 'LOCKED';
                            flexState.wantsArming = false;
                        }
                    }
                    else if (flexState.type === 'LINE_LOCK') {
                        data.scanLineItemId = flexState.lockedLineId;
                        delete data.substituteLineId;
                    }
                }
            }
            return originalRequest.apply(this, arguments);
        };
    }

    function hijackActivation() {
        const MainVC = Ext.ClassManager.get('ExtFlex.warehouse.equipmentlist.EquipmentListScanVC');
        if (MainVC?.prototype.activateLineItemSubstitution) {
            const innerOrig = MainVC.prototype.activateLineItemSubstitution;
            MainVC.prototype.activateLineItemSubstitution = function() {
                // Hard block spoofed auto-subs
                if (flexState.wantsArming && flexState.type === 'AUTO_SUB' && !flexState.isAuthorizedManager) return;
                return innerOrig.apply(this, arguments);
            };
        }
    }
})();
