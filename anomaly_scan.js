/**
 * HiveHyde Anti-Crawler System - Anomaly Scanner
 * 
 * 功能:
 * 1. 专门用于检测自动化工具（如Puppeteer, Playwright）和模拟环境。
 * 2. 包含一系列精准的、针对性的检测函数。
 * 3. 每个检测函数返回一个布尔值或描述异常的字符串。
 * 4. 提供一个统一的 run 方法，执行所有扫描并返回一个结果对象。
 *
 * @version 1.0
 */
(function(window) {
    'use strict';
    const HiveHyde = window.HiveHyde || (window.HiveHyde = {});

    // --- 私有检测函数 ---

    /**
     * 检测 navigator.webdriver 标志
     * @private
     */
    function _detectWebDriver() {
        return navigator.webdriver || false;
    }

    /**
     * 检测 navigator.webdriver 是否被篡改 (修正版，更宽容)
     * @private
     */
    function _detectWebDriverTampering() {
        try {
            const descriptor = Object.getOwnPropertyDescriptor(navigator, 'webdriver');
            // 只有当 webdriver 属性存在，且是可配置的，才认为是可疑的篡改行为
            // 如果属性不存在 (descriptor 为 undefined)，这是正常浏览器的表现
            return descriptor ? descriptor.configurable : false;
        } catch (e) {
            // 在严格模式或特殊浏览器下，访问出错也视为一种异常信号
            return true;
        }
    }

    /**
     * 检测无头浏览器常见的 window.chrome 对象异常
     * @private
     */
    function _detectHeadlessChrome() {
        if (!window.chrome || !window.chrome.runtime) {
            return false;
        }
        try {
            if (!('csi' in window.chrome) || typeof window.chrome.csi !== 'function') {
                 return true;
            }
        } catch(e) {
            return true;
        }
        return false;
    }
    
    /**
     * 检测 Function.prototype.toString 是否被 Hook
     * @private
     */
    function _detectToStringTampering() {
        try {
            const nativeToString = Function.prototype.toString;
            if (nativeToString.call(Date).indexOf('native code') < 0) {
                return true;
            }
            const func = function() { return 1; };
            if (nativeToString.call(func).includes('return 1') === false) {
                 return true;
            }
        } catch (e) {
            return true;
        }
        return false;
    }

    /**
     * 通过分析错误堆栈来检测异常 (修正版，更健壮)
     * @private
     */
    function _detectStackAnomaly() {
        try {
            throw new Error('HiveHydeStackTest');
        } catch (e) {
            if (!e.stack || typeof e.stack !== 'string') {
                return 'no_stack';
            }
            const stack = e.stack.toLowerCase();
            // 检查堆栈中是否包含常见的自动化工具特征词
            if (stack.includes('puppeteer') || stack.includes('webdriver') || stack.includes('phantom')) {
                return 'contains_keyword';
            }
            // 真实浏览器的堆栈通常至少有2-3层
            if (e.stack.split('\n').length < 3) {
                return 'stack_too_short';
            }
            // 移除了对 "hivehyde_anti" 文件名的检查，因为它在打包后会变化，非常不可靠
        }
        return false;
    }

    /**
     * 检测权限API的状态
     * @private
     */
    async function _detectPermissions() {
        try {
            if (!navigator.permissions || typeof navigator.permissions.query !== 'function') {
                return 'no_permissions_api';
            }
            const permissionStatus = await navigator.permissions.query({ name: 'notifications' });
            return permissionStatus.state === 'denied' && ('Notification' in window && Notification.permission === 'denied');
        } catch (e) {
            return 'permissions_error';
        }
    }


    // --- 公共接口 ---

    /**
     * 执行所有异常扫描任务
     * @returns {Promise<object>} - 包含所有扫描结果的对象
     * @public
     */
    async function run() {
        const results = {
            webdriver: _detectWebDriver(),
            webdriver_tampered: _detectWebDriverTampering(),
            headless_chrome: _detectHeadlessChrome(), 
            tostring_tampered: _detectToStringTampering(),
            stack_anomaly: _detectStackAnomaly(),
            permissions_denied: false 
        };

        const permResult = await _detectPermissions();
        if (typeof permResult === 'boolean') {
            results.permissions_denied = permResult;
        } else {
            results.permissions_error = permResult;
        }

        return results;
    }

    // --- 暴露接口 ---
    HiveHyde.AnomalyScan = {
        run
    };

})(window);