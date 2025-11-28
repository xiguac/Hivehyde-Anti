/**
 * HiveHyde Anti-Crawler System - Session Vault
 *
 * 功能:
 * 1. 负责与后端通信，获取动态会话密钥 (session_key) 和会话令牌 (token)。
 * 2. 安全地在内存中存储当前会话信息。
 * 3. 实现无感知的密钥自动续期机制，保证用户体验。
 * 4. 提供统一的接口供其他模块获取当前有效的密钥和令牌。
 *
 * @version 1.0
 */
(function(window) {
    'use strict';

    const HiveHyde = window.HiveHyde || (window.HiveHyde = {});

    // --- 内部状态 ---
    let sessionKey = null;   // 当前会话密钥 (私有，不直接暴露)
    let sessionToken = null; // 当前会话令牌 (公开，用于后端快速查找密钥)
    let expiresAt = 0;       // 密钥过期时间戳 (毫秒)
    let isRefreshing = false; // 状态锁，防止并发续期

    // --- 配置常量 ---
    const API_INIT_ENDPOINT = '/warden/init'; // 获取密钥的后端API端点
    const KEY_LIFESPAN_MS = 30 * 60 * 1000;   // 密钥有效期：30分钟
    const REFRESH_BUFFER_MS = 2 * 60 * 1000;  // 提前续期缓冲时间：2分钟

    /**
     * 向后端请求新的会话密钥和令牌
     * @private
     */
    async function _fetchNewSession() {
        if (!HiveHyde.config || !HiveHyde.config.apiBaseUrl) {
            throw new Error('apiBaseUrl configuration is missing. Cannot fetch session.');
        }

        const apiBaseUrl = HiveHyde.config.apiBaseUrl;
        const fullApiUrl = `${apiBaseUrl}${API_INIT_ENDPOINT}`;

        console.log(`[HiveHyde] SessionVault: Fetching key from ${fullApiUrl}`);

        try {
            const response = await fetch(fullApiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                // 可以附带一些初步信息，但此阶段不建议发送过多指纹
                // body: JSON.stringify({ client_version: '4.2' })
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch session, server responded with status: ${response.status}`);
            }

            const responseData = await response.json();

            // 严格的响应数据校验
            if (responseData.code !== 0 || !responseData.data || typeof responseData.data.key !== 'string' || typeof responseData.data.token !== 'string') {
                const errorMsg = responseData.msg || 'Invalid or malformed session data from server.';
                throw new Error(errorMsg);
            }

            const sessionData = responseData.data;
            sessionKey = sessionData.key;
            sessionToken = sessionData.token;
            expiresAt = Date.now() + KEY_LIFESPAN_MS;

            console.log('[HiveHyde] New session key and token acquired successfully.');

        } catch (error) {
            // 请求失败或解析失败，清空所有状态
            sessionKey = null;
            sessionToken = null;
            expiresAt = 0;
            console.error('[HiveHyde] Error fetching new session:', error.message);
            // 将原始错误包装后向上抛出
            throw new Error(`[HiveHyde] Session fetching failed: ${error.message}`);
        }
    }

    /**
     * 检查并处理密钥续期
     * @private
     */
    async function _checkAndRefreshToken() {
        // 如果当前没有密钥，或者密钥不需要续期，或者正在续期中，则直接返回
        if (!sessionKey || Date.now() < expiresAt - REFRESH_BUFFER_MS || isRefreshing) {
            return;
        }

        console.log('[HiveHyde] Session key is about to expire. Refreshing silently...');
        isRefreshing = true; // 上锁

        try {
            await _fetchNewSession();
        } catch (error) {
            // 静默续期失败，只打印错误，不中断应用
            console.error('[HiveHyde] Silent refresh failed. Will continue with old key and retry on next request.', error.message);
        } finally {
            isRefreshing = false; // 确保解锁
        }
    }


    // --- 公共接口 ---

    /**
     * 初始化会话管理器
     * @public
     */
    async function initialize() {
        // 首次启动，必须成功获取密钥
        return _fetchNewSession();
    }

    /**
     * 获取当前有效的会话密钥
     * @returns {Promise<string|null>}
     * @public
     */
    async function getCurrentKey() {
        // 每次获取密钥前，都先检查一下是否需要续期
        await _checkAndRefreshToken();
        return sessionKey;
    }

    /**
     * 获取当前有效的会话令牌
     * @returns {string|null}
     * @public
     */
    function getCurrentToken() {
        return sessionToken;
    }


    // --- 暴露接口 ---
    HiveHyde.SessionVault = {
        initialize,
        getCurrentKey,
        getCurrentToken
    };

})(window);
