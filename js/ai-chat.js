/**
 * AI Chat Assistant Widget — 交互逻辑
 *
 * 原生 JavaScript，不依赖 jQuery。
 * 功能：面板开关、文章上下文提取、SSE 流式消息、多轮对话、错误处理
 */
(function () {
  'use strict';

  // ==========
  // 配置读取
  // ==========
  var config = window.__AI_CHAT_CONFIG || {};

  var API_URL = config.apiUrl || '';
  var MODEL = config.model || 'claude-sonnet-4-6';
  var MAX_CONTEXT_CHARS = config.maxContextChars || 3000;
  var SYSTEM_PROMPT =
    config.systemPrompt ||
    '你是一个嵌入在中文技术博客中的 AI 助手。请用中文简洁、友好地回答用户的问题。';

  // ==========
  // 状态
  // ==========
  var isOpen = false;
  var isStreaming = false;
  var articleContext = null; // 缓存文章上下文，首次打开时提取
  var conversation = []; // 多轮对话历史

  // ==========
  // DOM 引用（延迟获取）
  // ==========
  var toggleBtn = null;
  var panel = null;
  var closeBtn = null;
  var messagesEl = null;
  var loadingEl = null;
  var inputEl = null;
  var sendBtn = null;

  function getElements() {
    if (toggleBtn) return; // 已缓存
    toggleBtn = document.getElementById('ai-chat-toggle');
    panel = document.getElementById('ai-chat-panel');
    closeBtn = document.getElementById('ai-chat-close');
    messagesEl = document.getElementById('ai-chat-messages');
    loadingEl = document.getElementById('ai-chat-loading');
    inputEl = document.getElementById('ai-chat-input');
    sendBtn = document.getElementById('ai-chat-send');
  }

  // ==========
  // 文章上下文提取
  // ==========
  function getArticleContext() {
    if (articleContext) return articleContext;

    // 提取文章标题（去掉站点名后缀）
    var title = document.title.split(' | ')[0] || document.title;

    // 提取文章正文
    var articleEl = document.querySelector('.article-entry');
    var content = '';
    if (articleEl) {
      content = articleEl.textContent.replace(/\s+/g, ' ').trim();
      if (content.length > MAX_CONTEXT_CHARS) {
        content = content.substring(0, MAX_CONTEXT_CHARS) + '...';
      }
    }

    articleContext = { title: title, content: content };
    return articleContext;
  }

  // ==========
  // 系统提示词构建
  // ==========
  function buildSystemMessage() {
    var ctx = getArticleContext();
    var parts = [SYSTEM_PROMPT];

    if (ctx.content) {
      parts.push('\n当前读者正在阅读以下文章：');
      parts.push('标题：' + ctx.title);
      parts.push('内容摘要：' + ctx.content);
      parts.push('\n请基于以上文章内容回答读者的问题。如果答案不在文章中，可以基于你的知识补充，但要说明哪些来自文章、哪些来自你的知识。');
    } else {
      parts.push('\n读者当前在博客首页或列表页，没有具体的文章内容。请友好地提供帮助。');
    }

    return parts.join('\n');
  }

  // ==========
  // 面板开关
  // ==========
  function openPanel() {
    getElements();
    if (!panel || !toggleBtn) return;

    // 首次打开时提取上下文
    getArticleContext();

    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    toggleBtn.classList.add('hidden');
    isOpen = true;

    // 滚动到底部
    scrollToBottom();
    // 聚焦输入框
    setTimeout(function () {
      if (inputEl) inputEl.focus();
    }, 300);
  }

  function closePanel() {
    getElements();
    if (!panel || !toggleBtn) return;

    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    toggleBtn.classList.remove('hidden');
    isOpen = false;
  }

  function togglePanel() {
    if (isOpen) {
      closePanel();
    } else {
      openPanel();
    }
  }

  // ==========
  // 消息渲染
  // ==========
  function appendMessage(role, text) {
    getElements();
    if (!messagesEl) return null;

    var messageDiv = document.createElement('div');
    messageDiv.className = 'ai-chat-message ' + role;

    // 头像
    var avatar = document.createElement('div');
    avatar.className = 'ai-chat-avatar';
    var icon = document.createElement('span');
    icon.className = 'fa ' + (role === 'bot' ? 'fa-android' : 'fa-user');
    avatar.appendChild(icon);

    // 气泡
    var bubble = document.createElement('div');
    bubble.className = 'ai-chat-bubble';
    var p = document.createElement('p');
    p.textContent = text;
    bubble.appendChild(p);

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(bubble);
    messagesEl.appendChild(messageDiv);

    scrollToBottom();
    return messageDiv;
  }

  /**
   * 创建或获取一个正在流式写入的 bot 消息气泡
   */
  function getOrCreateStreamingBubble() {
    getElements();
    // 查找最后一个 bot 消息，如果它带有 data-streaming 属性则返回
    var lastBot = messagesEl.querySelector('.ai-chat-message.bot:last-child');
    if (lastBot && lastBot.getAttribute('data-streaming') === 'true') {
      return lastBot;
    }
    // 创建新的
    var msg = appendMessage('bot', '');
    msg.setAttribute('data-streaming', 'true');
    return msg;
  }

  function finalizeStreamingBubble() {
    getElements();
    var streaming = messagesEl.querySelector('.ai-chat-message.bot[data-streaming="true"]');
    if (streaming) {
      streaming.removeAttribute('data-streaming');
    }
  }

  function appendError(text) {
    getElements();
    var messageDiv = document.createElement('div');
    messageDiv.className = 'ai-chat-message error';

    var bubble = document.createElement('div');
    bubble.className = 'ai-chat-bubble';
    bubble.textContent = text;

    messageDiv.appendChild(bubble);
    messagesEl.appendChild(messageDiv);
    scrollToBottom();
  }

  function showLoading() {
    getElements();
    if (loadingEl) loadingEl.style.display = 'flex';
  }

  function hideLoading() {
    getElements();
    if (loadingEl) loadingEl.style.display = 'none';
  }

  function setInputEnabled(enabled) {
    getElements();
    if (inputEl) {
      inputEl.disabled = !enabled;
      if (enabled) inputEl.focus();
    }
    if (sendBtn) sendBtn.disabled = !enabled;
  }

  function scrollToBottom() {
    if (messagesEl) {
      setTimeout(function () {
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }, 50);
    }
  }

  // ==========
  // API 调用（SSE 流式）
  // ==========
  async function sendMessage(userText) {
    if (isStreaming) return;
    if (!API_URL) {
      appendError('AI 服务尚未配置，请联系博主设置 API 地址。');
      return;
    }

    isStreaming = true;
    setInputEnabled(false);
    showLoading();

    // 添加用户消息到界面
    appendMessage('user', userText);

    // 构建消息列表
    var systemContent = buildSystemMessage();
    var messages = [];

    // 保留最近 5 轮对话（10 条消息）
    var recentHistory = conversation.slice(-10);
    messages = recentHistory.concat([{ role: 'user', content: userText }]);

    // 添加到对话历史
    conversation.push({ role: 'user', content: userText });

    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, 30000); // 30 秒超时

    try {
      var response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          system: systemContent,
          messages: messages,
          max_tokens: 1024,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        var errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = {};
        }
        throw new Error(
          errorData.error || 'AI 服务返回错误 (HTTP ' + response.status + ')'
        );
      }

      // 读取 SSE 流
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var fullResponse = '';
      var streamingBubble = null;

      hideLoading();

      while (true) {
        var result = await reader.read();
        var done = result.done;
        var value = result.value;

        if (value) {
          buffer += decoder.decode(value, { stream: !done });
        }

        // 解析 SSE 行
        var lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 保留不完整的最后一行

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (line.startsWith('data: ')) {
            var dataStr = line.substring(6);
            try {
              var data = JSON.parse(dataStr);

              if (data.error) {
                throw new Error(data.error);
              }

              if (data.delta) {
                if (!streamingBubble) {
                  streamingBubble = getOrCreateStreamingBubble();
                }
                fullResponse += data.delta;
                // 更新气泡内容
                var bubbleEl = streamingBubble.querySelector('.ai-chat-bubble p');
                if (bubbleEl) {
                  bubbleEl.textContent = fullResponse;
                }
                scrollToBottom();
              }

              if (data.done) {
                finalizeStreamingBubble();
              }
            } catch (parseErr) {
              // 忽略解析错误（可能是不完整的 JSON）
              if (parseErr.message && !parseErr.message.includes('JSON')) {
                throw parseErr;
              }
            }
          }
        }

        if (done) break;
      }

      // 流结束
      finalizeStreamingBubble();

      if (!fullResponse) {
        appendError('AI 没有返回回答，请换个问题试试。');
      } else {
        // 保存到对话历史
        conversation.push({ role: 'assistant', content: fullResponse });
      }
    } catch (err) {
      clearTimeout(timeoutId);
      hideLoading();
      finalizeStreamingBubble();

      if (err.name === 'AbortError') {
        appendError('请求超时，请稍后重试。');
      } else if (err.message && err.message.includes('Failed to fetch')) {
        appendError('网络连接失败，请检查网络后重试。');
      } else {
        appendError(err.message || 'AI 服务暂时不可用，请稍后重试。');
      }
    } finally {
      isStreaming = false;
      setInputEnabled(true);
      scrollToBottom();
    }
  }

  // ==========
  // 事件绑定
  // ==========
  function bindEvents() {
    getElements();

    // 切换面板
    if (toggleBtn) {
      toggleBtn.addEventListener('click', togglePanel);
    }

    // 关闭面板
    if (closeBtn) {
      closeBtn.addEventListener('click', closePanel);
    }

    // 发送消息
    function handleSend() {
      getElements();
      if (!inputEl) return;
      var text = inputEl.value.trim();
      if (!text || isStreaming) return;
      inputEl.value = '';
      inputEl.style.height = 'auto';
      sendMessage(text);
    }

    if (sendBtn) {
      sendBtn.addEventListener('click', handleSend);
    }

    if (inputEl) {
      // Enter 发送，Shift+Enter 换行
      inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });

      // 自动调整高度
      inputEl.addEventListener('input', function () {
        inputEl.style.height = 'auto';
        inputEl.style.height = Math.min(inputEl.scrollHeight, 100) + 'px';
      });
    }

    // ESC 关闭面板
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) {
        closePanel();
      }
    });
  }

  // ==========
  // 初始化
  // ==========
  function init() {
    if (!config.apiUrl && !API_URL) return; // 未配置则不初始化
    getElements();
    if (!toggleBtn || !panel) return; // DOM 未渲染
    bindEvents();
  }

  // DOM 就绪后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
