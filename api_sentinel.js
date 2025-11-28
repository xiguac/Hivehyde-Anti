/**
 * HiveHyde Anti-Crawler System - API Sentinel
 * 
 * 功能:
 * 1. 作为安全系统与应用HTTP请求库（如axios）之间的桥梁。
 * 2. 提供一个请求拦截器函数，自动为需要保护的API请求添加签名和安全头。
 * 3. 封装与core_engine的交互，简化集成过程。
 *
 * @version 1.0
 */
(function(window) {
    'use strict';

    const HiveHyde = window.HiveHyde || (window.HiveHyde = {});

    // --- 内部状态 ---
    let isInterceptorAttached = false;

    // --- 核心功能 ---

    /**
     * Axios请求拦截器的核心逻辑。
     * @param {object} config - Axios的请求配置对象
     * @returns {Promise<object>} - 修改后的配置对象
     * @private
     */
    async function _requestInterceptor(config) {
        if (!config.protect) {
            return config;
        }

        console.log(`[HiveHyde] Sentinel: Protecting request to ${config.url}`);

        try {
            // --- ✨【核心修复】调整 realUrlPath 的获取逻辑 ---

            // 1. 获取axios配置的baseURL。如果不存在，则为空字符串。
            const baseURL = config.baseURL || '';
            // 2. 获取请求的相对URL。
            const requestURL = config.url || '';

            // 3. 构造完整的URL，然后提取其路径部分。
            // 这种方法比字符串拼接更健壮，能处理各种baseURL和requestURL的组合。
            // 例如 baseURL='http://a.com/api', url='v1/users' -> http://a.com/api/v1/users
            // 例如 baseURL='http://a.com/api', url='/v1/users' -> http://a.com/v1/users (URL构造函数的标准行为)
            // 为了统一行为，我们自己拼接。
            
            const finalBase = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
            const finalRequest = requestURL.startsWith('/') ? requestURL : '/' + requestURL;
            
            // 拼接后再通过URL对象获取pathname，可以避免域名和端口的影响
            const tempFullPath = 'http://dummybase.com' + finalRequest; // 假设请求的是相对路径
            let realUrlPath = new URL(tempFullPath).pathname;

            if (finalBase) {
                // 如果有baseURL, 拼接baseURL的路径部分
                const basePath = new URL(finalBase).pathname.replace(/\/$/, '');
                realUrlPath = basePath + finalRequest;
            }


            const method = config.method || 'get';
            const params = (method.toLowerCase() === 'get') ? config.params : config.data;

            // 调用核心引擎时，传入修正后的 realUrlPath
            const signaturePackage = await HiveHyde.processRequest(realUrlPath, params || {}, method);

            if (signaturePackage.error) {
                throw new Error(`Signature generation failed: ${signaturePackage.message || signaturePackage.error}`);
            }

            // --- 将安全信息注入到请求头 ---
            config.headers = config.headers || {};
            config.headers['X-Hive-Timestamp'] = signaturePackage.timestamp;
            config.headers['X-Hive-Nonce'] = signaturePackage.nonce;
            config.headers['X-Hive-Signature'] = signaturePackage.signature;
            config.headers['X-Hive-Token'] = signaturePackage.token;
            config.headers['X-Hive-RiskScore'] = signaturePackage.riskScore;
            config.headers['X-Hive-Fingerprint-Json'] = signaturePackage.fingerprintJsonForSign;

            console.log('[HiveHyde] Sentinel: Headers attached successfully.');

            return config;

        } catch (error) {
            console.error('[HiveHyde] Sentinel: Failed to sign request. Aborting.', error.message);
            
            const axios = HiveHyde.axiosInstance; 
            if (axios && typeof axios.Cancel === 'function') {
                 const cancelSource = axios.CancelToken.source();
                 config.cancelToken = cancelSource.token;
                 cancelSource.cancel(`[HiveHyde] Request cancelled due to signing failure: ${error.message}`);
            }
            return Promise.reject(error);
        }
    }
    
    // --- 公共接口 ---

    /**
     * 将HiveHyde的安全拦截器附加到指定的axios实例上。
     * @param {object} axiosInstance - 要附加拦截器的axios实例
     * @public
     */
    function attachTo(axiosInstance) {
        if (!axiosInstance || !axiosInstance.interceptors) {
            console.error('[HiveHyde] Sentinel: Invalid axios instance provided.');
            return;
        }

        if (isInterceptorAttached) {
            console.warn('[HiveHyde] Sentinel: Interceptor already attached.');
            return;
        }

        HiveHyde.axiosInstance = axiosInstance;
        
        axiosInstance.interceptors.request.use(_requestInterceptor, (error) => {
            return Promise.reject(error);
        });
        
        isInterceptorAttached = true;
        console.log('[HiveHyde] Sentinel: Interceptor attached to axios instance successfully.');
    }

    // --- 暴露接口 ---
    HiveHyde.ApiSentinel = {
        attachTo
    };

})(window);