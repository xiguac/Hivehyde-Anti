/**
 * HiveHyde Anti-Crawler System - Risk Matrix
 *
 * 功能:
 * 1. 接收所有采集到的数据和动态权重，进行风险评分。
 * 2. 将所有关键信息进行严格的、有序的序列化。
 * 3. 使用会话密钥生成HMAC-SHA256签名并对指纹进行AES加密。
 * 4. 封装并返回一个包含所有待发送安全信息的包。
 *
 * @version 1.0
 */
(function(window) {
    'use strict';
    const HiveHyde = window.HiveHyde || (window.HiveHyde = {});

    if (typeof CryptoJS === 'undefined') {
        const errorMsg = '[HiveHyde] FATAL: CryptoJS library not found. Please include it before this script.';
        console.error(errorMsg);
        throw new Error(errorMsg);
    }

    // --- 私有辅助函数 ---

    function _serializeGetParams(params) {
        if (!params || typeof params !== 'object' || Object.keys(params).length === 0) {
            return '';
        }
        return Object.keys(params).sort().map(key =>
            `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`
        ).join('&');
    }

    function _canonicalJsonStringify(obj) {
        if (obj === null || typeof obj !== 'object') {
            return JSON.stringify(obj);
        }
        if (Array.isArray(obj)) {
            return `[${obj.map(item => _canonicalJsonStringify(item)).join(',')}]`;
        }
        const sortedKeys = Object.keys(obj).sort();
        const parts = sortedKeys.map(key => {
            const keyStr = JSON.stringify(key);
            const valStr = _canonicalJsonStringify(obj[key]);
            return `${keyStr}:${valStr}`;
        });
        return `{${parts.join(',')}}`;
    }
    
    /**
     * 风险评分引擎 (模型调优版)
     * @private
     */
    function _calculateRiskScore(collectedData, weights) {
        let score = 0;
        const reasons = [];

        // 异常扫描 (高权重)
        const anomalyData = collectedData.anomaly_scan || {};
        const anomalyWeight = weights.anomaly_scan || 50;
        if (anomalyData.webdriver) { score += anomalyWeight; reasons.push('webdriver'); }
        if (anomalyData.webdriver_tampered) { score += anomalyWeight * 1.2; reasons.push('webdriver_tampered'); }
        if (anomalyData.tostring_tampered) { score += anomalyWeight * 1.1; reasons.push('tostring_tampered'); }
        if (anomalyData.stack_anomaly) { score += anomalyWeight * 0.7; reasons.push(`stack:${anomalyData.stack_anomaly}`); }
        if (anomalyData.permissions_denied) { score += 5; reasons.push('permissions_denied'); }

        // 行为数据 (中等权重)
        const trajectoryData = collectedData.mouse_trajectory || { points: [], analysis: {} };
        const trajectoryWeight = weights.mouse_trajectory || 25;
        const platformData = collectedData.platform || {};
        const isTouchDevice = platformData.touchPoints > 0;

        if (trajectoryData.points.length === 0) { score += 3; reasons.push('no_mouse_movements'); }
        else if (trajectoryData.points.length < 5) { score += 2; reasons.push('few_mouse_movements'); }
        
        if (trajectoryData.analysis.is_straight_line) {
            const straightLineWeight = isTouchDevice ? 0.1 : 0.7;
            score += trajectoryWeight * straightLineWeight;
            reasons.push(`straight_line_trajectory (touch: ${isTouchDevice})`);
        } else if (trajectoryData.analysis.regularity_score > 0.5) {
            score += trajectoryWeight * 0.5;
            reasons.push('regular_trajectory');
        }
        
        const clickCount = platformData.clickCount || 0;
        if (clickCount === 0) { score += 1; reasons.push('no_clicks'); }
        else if (clickCount > 5 && trajectoryData.points.length > 20) { score -= 5; reasons.push('active_user_bonus'); }

        // 环境与性能数据 (低权重)
        const perfData = collectedData.performance;
        if (perfData && perfData.transferSize === 0 && perfData.type === 'navigate') { score -= 5; reasons.push('from_cache_bonus'); }
        
        const fingerprintErrors = ['err_canvas', 'err_no_webgl', 'err_webgl', 'err_no_offline_context', 'err_audio_render', 'err_audio_context', 'err_platform', 'err_screen', 'err_no_perf', 'err_no_perf_api', 'err_no_timing'];
        let errorCount = 0;
        for (const key in collectedData) {
            if (fingerprintErrors.includes(collectedData[key])) { 
                errorCount++;
            }
        }
        if (errorCount > 2) { 
            score += errorCount * 2;
            reasons.push(`${errorCount}_fingerprint_errors`);
        }

        console.log('[HiveHyde] Risk score calculation reasons:', reasons.join(', ') || 'No significant risks detected.');
        return Math.min(Math.round(Math.max(0, score)), 100);
    }

    /**
     * 使用会话密钥进行AES加密的辅助函数
     * @private
     */
    function _aesEncrypt(plaintext, key) {
        const keyHex = CryptoJS.enc.Hex.parse(key);
        const ivHex = CryptoJS.enc.Hex.parse(key.substring(0, 32));
        const encrypted = CryptoJS.AES.encrypt(plaintext, keyHex, {
            iv: ivHex,
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7
        });
        return encrypted.toString();
    }

    // --- 公共接口 ---

    async function assessAndSign(collectedData, weights, realUrl, params, method) {
        const sessionKey = await HiveHyde.SessionVault.getCurrentKey();
        if (!sessionKey) {
            throw new Error('Could not retrieve session key. Vault might be uninitialized or failed.');
        }

        const riskScore = _calculateRiskScore(collectedData, weights);
        const timestamp = Date.now();
        const nonce = `${timestamp}-${Math.random().toString(36).substring(2, 10)}`;
        const httpMethod = method.toUpperCase();

        let serializedParams = '';
        if (httpMethod === 'GET') {
            serializedParams = _serializeGetParams(params);
        } else if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(httpMethod)) {
            if (!params || Object.keys(params).length === 0) {
                serializedParams = "{}";
            } else {
                serializedParams = JSON.stringify(params);
            }
        }

        const rawFingerprintJson = JSON.stringify({
            platform: collectedData.platform ? collectedData.platform.platform : 'N/A',
            renderer: collectedData.webgl ? collectedData.webgl.renderer : 'N/A',
            audio: collectedData.audio,
        });

        const encryptedFingerprint = _aesEncrypt(rawFingerprintJson, sessionKey);

        const dataToSign = [
            timestamp,
            nonce,
            httpMethod,
            realUrl,
            serializedParams,
            riskScore,
            rawFingerprintJson
        ].join('||');

        const keyHex = CryptoJS.enc.Hex.parse(sessionKey);
        const signature = CryptoJS.HmacSHA256(dataToSign, keyHex).toString(CryptoJS.enc.Hex);

        return {
            signature,
            timestamp,
            nonce,
            riskScore,
            token: HiveHyde.SessionVault.getCurrentToken(),
            fingerprintJsonForSign: encryptedFingerprint
        };
    }

    HiveHyde.RiskMatrix = {
        assessAndSign
    };

})(window);