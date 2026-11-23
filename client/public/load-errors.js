// When Wrkbench fails to start, says why instead of leaving a blank page: an error while the app's code
// loads or first draws, or a file of it that could not be fetched. Older browsers (such as Chrome on a
// mobile computer that no longer updates) are where this happens, and the message is what lets it be fixed.
// A separate file rather than an inline script so the server's Content-Security-Policy (script-src 'self')
// allows it. Plain old JavaScript on purpose: it must run where the app's own code cannot.
(function () {
  function show(message) {
    var root = document.getElementById('root');
    if (!root || root.childElementCount > 0 || document.getElementById('load-error')) return;
    var box = document.createElement('div');
    box.id = 'load-error';
    box.className = 'load-error';
    var title = document.createElement('h1');
    title.textContent = 'Wrkbench could not start';
    var text = document.createElement('p');
    text.textContent = 'Send this message to whoever looks after Wrkbench:';
    var detail = document.createElement('pre');
    detail.textContent = message + '\n\n' + navigator.userAgent;
    var reload = document.createElement('button');
    reload.type = 'button';
    reload.textContent = 'Reload';
    reload.onclick = function () {
      window.location.reload();
    };
    box.appendChild(title);
    box.appendChild(text);
    box.appendChild(detail);
    box.appendChild(reload);
    root.appendChild(box);
  }

  // Checked a moment later, once the app has had its chance to draw: an error it recovers from shows nothing.
  function later(message) {
    window.setTimeout(function () {
      show(message);
    }, 1500);
  }

  window.addEventListener(
    'error',
    function (event) {
      var target = event.target;
      if (target && target !== window && (target.src || target.href)) {
        later('Could not load ' + (target.src || target.href));
        return;
      }
      var where = event.filename ? ' (' + event.filename.split('/').pop() + ':' + event.lineno + ':' + event.colno + ')' : '';
      later((event.message || 'Unknown error') + where);
    },
    true,
  );
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    later('Unhandled: ' + ((reason && (reason.stack || reason.message)) || String(reason)));
  });
})();
