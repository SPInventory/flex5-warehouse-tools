// ==UserScript==
// @name         Flex5 - The Gated Hash (v7.10)
// @namespace    http://tampermonkey.net/
// @version      7.11
// @description  Hashed manager gate with pre-execution checks and strict Auto-Sub logic blocking.
// @author       Ethan Bell / AI Collaborator
// @match        *://streamlineprod.flexrentalsolutions.com/*
// @updateURL    https://raw.githubusercontent.com/SPInventory/flex5-warehouse-tools/refs/heads/main/flex5-lock-user.js
// @downloadURL  https://raw.githubusercontent.com/SPInventory/flex5-warehouse-tools/refs/heads/main/flex5-lock-user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/* global Ext */

(function() {
    'use strict';

    // ==========================================
    //                MANAGER LIST
    // Base64 + Salt hashed names. Do not edit directly.
    // ==========================================
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
        targetBarcode: null,
        wantsArming: false,
        lastInterceptedId: null,
        isAuthorizedManager: false // Cached global permission
    };

    // --- 1. CSS FOR FEEDBACK ---
    const style = document.createElement('style');
    style.innerHTML = `
        .flex-locked-row-pink, .flex-locked-row-pink .x-grid-cell {
            background-color: rgb(250, 224, 223) !important;
        }
        .flex-locked-row-pink .x-grid-cell-inner {
            color: rgb(229, 57, 53) !important;
            font-weight: bold !important;
        }
    `;
    document.head.appendChild(style);

    // --- 2. BOOT SEQUENCE & SECURITY CHECK ---
    let initTimer = setInterval(() => {
        // Run security scan constantly until we find the user's name on boot
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
        if (flexState.isAuthorizedManager) return; // Already confirmed

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

                if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
                    document.activeElement.blur();
                    window.focus();
                }

                if (inputEl && inputEl.readOnly !== true) {
                    inputEl.readOnly = true;
                    inputEl.value = flexState.type === 'LINE_LOCK' ? "LINE LOCK ACTIVE" : "AUTO-SUB ACTIVE";

                    inputEl.style.setProperty('background-color', 'rgb(250, 224, 223)', 'important');
                    inputEl.style.setProperty('color', 'rgb(229, 57, 53)', 'important');
                    inputEl.style.setProperty('font-weight', 'bold', 'important');
                    inputEl.style.setProperty('text-align', 'center', 'important');
                    inputEl.style.setProperty('cursor', 'pointer', 'important');
                    inputEl.style.setProperty('border', '1px solid rgb(229, 57, 53)', 'important');

                    inputEl.onclick = (e) => {
                        e.preventDefault();
                        cancelLock();
                    };
                }
            } else if (inputEl && inputEl.readOnly) {
                inputEl.readOnly = false;
                inputEl.value = "";
                inputEl.style.removeProperty('background-color');
                inputEl.style.removeProperty('color');
                inputEl.style.removeProperty('font-weight');
                inputEl.style.removeProperty('text-align');
                inputEl.style.removeProperty('cursor');
                inputEl.style.removeProperty('border');

                inputEl.placeholder = "Search...";
                inputEl.onclick = null;
                document.querySelectorAll('.flex-locked-row-pink').forEach(r => r.classList.remove('flex-locked-row-pink'));
            }
        }, 200);
    }

    function cancelLock() {
        flexState.mode = 'OFF';
        flexState.type = null;
        flexState.wantsArming = false;
        flexState.lockedLineId = null;
        const nativeCancel = document.querySelector('.x-btn-icon-el-default-toolbar-small.fa-ban');
        if (nativeCancel) nativeCancel.closest('.x-btn').click();
    }

    // --- 4. MENU INTEGRATION (GATED) ---
    function hijackMenu() {
        const origAdd = Ext.menu.Menu.prototype.add;
        Ext.menu.Menu.prototype.add = function() {
            const addedItems = origAdd.apply(this, arguments);
            try {
                const subBtn = this.down('menuitem[text*="Substitute Line"]');
                if (!subBtn || this.down('[itemId=lineLockBtn]')) return addedItems;

                const record = this.config?.record || this.rec;

                // LINE LOCK (Always visible)
                this.insert(this.items.indexOf(subBtn) + 1, Ext.create('Ext.menu.Item', {
                    itemId: 'lineLockBtn',
                    text: 'Line Lock',
                    iconCls: 'x-fa fa-lock',
                    handler: function() { arm('LINE_LOCK', record, subBtn); }
                }));

                // AUTO-SUB (Restricted to Managers)
                if (flexState.isAuthorizedManager) {
                    this.insert(this.items.indexOf(subBtn) + 2, Ext.create('Ext.menu.Item', {
                        itemId: 'autoSubLockBtn',
                        text: 'Auto-Sub',
                        iconCls: 'x-fa fa-retweet',
                        handler: function() { arm('AUTO_SUB', record, subBtn); }
                    }));
                }
            } catch (err) {}
            return addedItems;
        };
    }

    function arm(type, record, subBtn) {
        // Hard block: if someone spoofs the click event
        if (type === 'AUTO_SUB' && !flexState.isAuthorizedManager) return;

        flexState.type = type;
        flexState.lockedLineId = flexState.lastInterceptedId || (record ? record.get('id') : null);

        if (record) {
            const data = record.get('inventoryModelData') || record.getData();
            flexState.targetBarcode = data.barcode || "";
        }

        if (type === 'AUTO_SUB') {
            flexState.wantsArming = true;
            if (subBtn.handler) subBtn.handler.call(subBtn.scope || subBtn, subBtn);
        } else {
            if (document.activeElement) document.activeElement.blur();
            window.focus();
            flexState.mode = 'LOCKED';
        }
    }

    // --- 5. LOG-MATCHED DATA ENFORCEMENT ---
    function hookExtAjax() {
        const originalRequest = Ext.Ajax.request;
        Ext.Ajax.request = function(options) {
            if (options.url?.includes('/additional-action-info')) {
                const match = options.url.match(/\/line-item\/([a-f0-9-]+)\/additional-action-info/);
                if (match && match[1]) flexState.lastInterceptedId = match[1];
            }

            if (options.url?.includes('/api/warehouse/scan') && options.jsonData) {
                const data = options.jsonData;

                if (flexState.mode === 'LOCKED' || flexState.wantsArming) {

                    if (flexState.type === 'AUTO_SUB') {
                        // Hard block: Disable logic completely for non-managers
                        if (!flexState.isAuthorizedManager) return originalRequest.apply(this, arguments);

                        data.scanLineItemId = "";
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
                // Hard block: Native sub intercept
                if (flexState.wantsArming && flexState.type === 'AUTO_SUB' && flexState.isAuthorizedManager) {
                    return innerOrig.apply(this, arguments);
                }
            };
        }
    }
})();
