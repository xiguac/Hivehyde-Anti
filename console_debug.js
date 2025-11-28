// =================== 调试代码 - 开始 ===================

(function() {
    if (typeof CryptoJS === 'undefined' || typeof CryptoJS.HmacSHA256 === 'undefined') {
        console.error("[Hive-Anti-Debug] CryptoJS is not ready. Please make sure it's loaded.");
        return;
    }

    // 1. 保存原始的加密函数
    const originalHmacSHA256 = CryptoJS.HmacSHA256;

    // 2. 用我们的函数替换它
    CryptoJS.HmacSHA256 = function(data, key) {
        console.groupCollapsed('%c[Hive-Anti-Debug] Signature Calculation Intercepted', 'color: #e67e22; font-weight: bold;');
        
        // 3. 打印出所有加密前的原始值！
        console.log('%cData To Sign (Client):', 'font-weight: bold; color: #3498db;');
        console.log(data); // 这就是前端最终用于签名的那个超长字符串

        // CryptoJS内部会将key转为WordArray，我们把它转回十六进制字符串，方便和后端比对
        const keyAsHex = key.toString(CryptoJS.enc.Hex);
        console.log('%cSecret Key (Hex, Client):', 'font-weight: bold; color: #2ecc71;');
        console.log(keyAsHex); // 这就是前端使用的会话密钥

        // 4. 调用原始的加密函数，确保功能不受影响
        const signature = originalHmacSHA256(data, key);
        const signatureAsHex = signature.toString(CryptoJS.enc.Hex);

        console.log('%cCalculated Signature (Client):', 'font-weight: bold; color: #9b59b6;');
        console.log(signatureAsHex);

        console.groupEnd();

        // 5. 返回原始的计算结果
        return signature;
    };

    console.log('%c[Hive-Anti-Debug] HMAC-SHA256 function has been patched for debugging. Now perform the action to trigger the signature.', 'background: #2c3e50; color: #ecf0f1; padding: 2px 5px; border-radius: 3px;');

})();

// =================== 调试代码 - 结束 ===================