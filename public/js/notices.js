/**
 * Render an in-site notice as plain text nodes.
 */
(function (root) {
  function isHttpsLink(value) {
    if (typeof value !== 'string' || !value.startsWith('https://') || /\s/.test(value)) return false;
    try {
      var url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && url.href.startsWith('https://');
    } catch (err) {
      return false;
    }
  }

  function renderNotice(notice, handlers) {
    var item = notice || {};
    var unread = !!item.unread;
    var article = document.createElement('article');
    article.className = 'border rounded-2xl p-3 ' + (unread ? 'border-blue-500' : 'border-slate-800');

    var title = document.createElement('h4');
    title.className = 'font-medium text-sm';
    title.textContent = item.title == null ? '' : String(item.title);
    article.appendChild(title);

    var body = document.createElement('p');
    body.className = 'text-sm text-slate-300 mt-1 whitespace-pre-wrap';
    body.textContent = item.body == null ? '' : String(item.body);
    article.appendChild(body);

    if (isHttpsLink(item.link_url)) {
      var link = document.createElement('a');
      link.className = 'block text-xs text-blue-400 underline mt-1 break-all';
      link.textContent = item.link_url;
      link.href = item.link_url;
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      article.appendChild(link);
    }

    var when = document.createElement('p');
    when.className = 'text-xs text-slate-500 mt-1';
    when.textContent = item.created_at == null ? '' : String(item.created_at);
    article.appendChild(when);

    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'mt-2 text-xs px-3 py-1.5 border border-slate-700 rounded-xl';
    button.textContent = unread ? 'Mark read' : 'Dismiss';
    button.addEventListener('click', function () {
      if (!handlers) return;
      if (unread && typeof handlers.onRead === 'function') handlers.onRead();
      else if (typeof handlers.onDismiss === 'function') handlers.onDismiss();
    });
    article.appendChild(button);
    return article;
  }

  var api = { isHttpsLink: isHttpsLink, renderNotice: renderNotice };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PypNotices = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
