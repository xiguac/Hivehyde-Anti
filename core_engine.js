/**
 * HiveHyde Anti-Crawler System - Core Engine
 * 
 * 功能:
 * 1. 作为整个系统的唯一入口和总调度器。
 * 2. 初始化所有模块，并进行环境能力自检。
 * 3. 根据环境能力，生成动态的采集和评估策略。
 * 4. 提供一个核心处理函数，驱动整个签名生成流程。
 *
 * @version 1.0
 */
(function(window) {
    'use strict';

    // 创建或获取 HiveHyde 全局命名空间
    const HiveHyde = window.HiveHyde || (window.HiveHyde = {});

    // --- 内部状态 ---
    let isInitialized = false;
    let currentPolicy = null;
    let config = {
        apiBaseUrl: ''
    };

    /**
     * [模块0] 能力检测与策略调度器 (CapabilityDetector & PolicyScheduler)
     * 检测当前浏览器环境支持哪些功能，并据此生成本次运行的策略。
     * @private
     */
    function _generateDynamicPolicy() {
        const capabilities = {
            hasScreen: !!window.screen,
            hasNavigator: !!window.navigator,
            hasCanvas: (() => { try { return !!document.createElement('canvas').getContext('2d'); } catch (e) { return false; } })(),
            hasOfflineAudioContext: !!(window.OfflineAudioContext || window.webkitOfflineAudioContext),
            hasWebGL: (() => { try { return !!document.createElement('canvas').getContext('webgl'); } catch (e) { return false; } })(),
            hasPerformance: !!window.performance && typeof window.performance.getEntriesByType === 'function',
            hasDeviceMotion: 'DeviceMotionEvent' in window,
            isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream,
        };

        // --- 基于能力生成动态策略 ---
        const policy = {
            collectors: [], // 要执行的采集器列表
            weights: {}     // 风险评分权重
        };

        // 1. 高兼容性采集点 (总是执行)
        policy.collectors.push('platform', 'screen', 'language', 'plugins');
        policy.weights.plugins = 5;

        // 2. 中等兼容性采集点 (支持则采)
        if (capabilities.hasCanvas) {
            policy.collectors.push('canvas');
            policy.weights.canvas = 15;
        }
        if (capabilities.hasWebGL) {
            policy.collectors.push('webgl');
            policy.weights.webgl = 15;
        }
        if (capabilities.hasOfflineAudioContext && !capabilities.isIOS) {
            policy.collectors.push('audio');
            policy.weights.audio = 20;
        }

        // 3. 动态活性与环境采集点
        if (capabilities.hasPerformance) {
            policy.collectors.push('performance');
            policy.weights.performance = 5; // 权重降低，作为修正项
        }
        policy.collectors.push('mouse_trajectory');
        policy.weights.mouse_trajectory = 25;
        
        // ✨【BUG修复】将 anomaly_scan 加入到采集任务列表中
        // 这是至关重要的一步，确保异常扫描模块会被执行
        policy.collectors.push('anomaly_scan'); 
        policy.weights.anomaly_scan = 50; // 异常扫描拥有高权重

        console.log('[HiveHyde] Dynamic policy generated:', policy);
        return policy;
    }

    /**
     * 核心处理函数 - 驱动整个签名流程
     * @param {string} realUrl - API的真实URL路径
     * @param {object} params - 请求参数 (GET的params或POST的body)
     * @param {string} method - HTTP请求方法 ('GET', 'POST', etc.)
     * @returns {Promise<object>} - 包含签名所需数据的对象
     * @public
     */
    async function processRequest(realUrl, params, method) {
        if (!isInitialized) {
            throw new Error('[HiveHyde] Error: System is not initialized. Please call HiveHyde.initialize() first.');
        }
        try {
            // 注意：AnomalyScan的执行现在被包含在DataLoom的gather中了，因为我们把它加入了策略
            const allCollectedData = await HiveHyde.DataLoom.gather(currentPolicy.collectors);
            
            // 将采集到的数据直接交给 RiskMatrix 处理
            const signaturePackage = await HiveHyde.RiskMatrix.assessAndSign(
                allCollectedData,
                currentPolicy.weights,
                realUrl,
                params,
                method
            );
            return signaturePackage;
        } catch (error) {
            console.error('[HiveHyde] Critical error during request processing:', error);
            return { error: 'processing_failed', message: error.message };
        }
    }

    /**
     * 初始化函数 - 整个系统的入口
     * @param {object} userConfig - 用户传入的配置对象
     * @param {string} userConfig.apiBaseUrl - 后端API的基地址
     * @returns {Promise<boolean>}
     * @public
     */
    async function initialize(userConfig) {
        if (isInitialized) {
            console.warn('[HiveHyde] Warning: System already initialized.');
            return true;
        }
        if (!userConfig || typeof userConfig.apiBaseUrl !== 'string' || userConfig.apiBaseUrl.trim() === '') {
            throw new Error('[HiveHyde] FATAL: `apiBaseUrl` (string) must be provided in the configuration object during initialization.');
        }
        config = { ...config, ...userConfig };
        HiveHyde.config = config;
        
        console.log(`[HiveHyde] Initializing with API base URL: ${config.apiBaseUrl}`);
        
        try {
            currentPolicy = _generateDynamicPolicy();
            await HiveHyde.SessionVault.initialize();
            if (HiveHyde.DataLoom && typeof HiveHyde.DataLoom.startListeners === 'function') {
                HiveHyde.DataLoom.startListeners();
            }
            isInitialized = true;
            console.log('[HiveHyde] Initialization successful.');
            return true;
        } catch (error) {
            console.error('[HiveHyde] FATAL: Initialization failed!', error.message);
            isInitialized = false;
            throw error;
        }
    }

    // --- 将公共接口暴露到 HiveHyde 命名空间 ---
    HiveHyde.initialize = initialize;
    HiveHyde.processRequest = processRequest;

})(window);