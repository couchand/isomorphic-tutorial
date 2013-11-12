var director = require('director')
  , isServer = typeof window === 'undefined'
  , Handlebars = isServer ? require('handlebars') : require('hbsfy/runtime')
  , viewsDir = (isServer ? __dirname : 'app') + '/views'
  , DirectorRouter = isServer ? director.http.Router : director.Router
  , firstRender = true
  , doRoute = isServer
    ? function(router, html, routeContext) {
        router.handleServerRoute(html, routeContext.req, routeContext.res);
    }
    : function(router, html) {
        router.handleClientRoute(html);
    }
;

// Register Handlebars Helpers
require('./helpers')(Handlebars).register();

module.exports = Router;

function Router(routesFn) {
  if (routesFn == null) throw new Error("Must provide routes.");

  this.directorRouter = new DirectorRouter(this.parseRoutes(routesFn));
}

/**
 * Capture routes as object that can be passed to Director.
 */
Router.prototype.parseRoutes = function(routesFn) {
  var routes = {}
    , capture;

  // Server routes are an object, not a function. We just use `get`.
  capture = isServer
    ? function(pattern, handler) {
      routes[pattern] = {
        get: this.getRouteHandler(handler)
      };
    }
    : function(pattern, handler) {
      routes[pattern] = this.getRouteHandler(handler);
    };

  routesFn(capture.bind(this));

  return routes;
};

Router.prototype.getRouteHandler = function(handler) {
  var router = this;

  return function() {
    /** If it's the first render on the client, just return; we don't want to
     * replace the page's HTML.
     */
    if (!isServer && firstRender) {
      firstRender = false;
      return;
    }

    // `routeContext` has `req` and `res` when on the server (from Director).
    var routeContext = this
      , params = Array.prototype.slice.call(arguments)
      , handleErr = router.handleErr.bind(routeContext)
    ;

    function handleRoute() {
      handler.apply(null, params.concat(function routeHandler(err, viewPath, data) {
        if (err) return handleErr(err);

        data = data || {};

        router.renderView(viewPath, data, function(err, html) {
          if (err) return handleErr(err);

          doRoute(router, html, routeContext);
        });
      }));
    }

    try {
      handleRoute();
    } catch (err) {
      handleErr(err);
    }
  };
};

Router.prototype.handleErr = function(err) {
  console.error(err.message + err.stack);

  // `this.next` is defined on the server.
  if (this.next) {
    this.next(err);
  } else {
    alert(err.message);
  }
};

Router.prototype.renderView = function(viewPath, data, callback) {
  try {
    var template = require(viewsDir + '/' + viewPath)
      , html = template(data)
    ;
    callback(null, html);
  } catch (err) {
    callback(err);
  }
};

Router.prototype.wrapWithLayout = function(html, callback) {
  try {
    var layout = require(viewsDir + '/layout')
      , layoutHtml = layout({body: html})
    ;
    callback(null, layoutHtml);
  } catch (err) {
    callback(err);
  }
};

Router.prototype.handleClientRoute = function(html) {
  document.getElementById('view-container').innerHTML = html;
};

Router.prototype.handleServerRoute = function(html, req, res) {
  this.wrapWithLayout(html, function(err, layoutHtml) {
    res.send(layoutHtml);
  });
};

/*
 * Express middleware function, for mounting routes onto an Express app.
 */
Router.prototype.middleware = function() {
  var directorRouter = this.directorRouter;

  return function middleware(req, res, next) {
    // Attach `this.next` to route handler, for better handling of errors.
    directorRouter.attach(function() {
      this.next = next;
    });

    // Dispatch the request to the Director router.
    directorRouter.dispatch(req, res, function (err) {
      // When a 404, just forward on to next Express middleware.
      if (err && err.status === 404) {
        next();
      }
    });
  };
};

/**
 * Client-side handler to start router.
 */
Router.prototype.start = function() {
  /**
   * Tell Director to use HTML5 History API (pushState).
   */
  this.directorRouter.configure({
    html5history: true
  });

  /**
   * Intercept any links that don't have 'data-pass-thru' and route using
   * pushState.
   */
  document.addEventListener('click', function(e) {
    var el = e.target
      , dataset = el && el.dataset
    ;
    if (el && el.nodeName === 'A' && (
        dataset.passThru == null || dataset.passThru === 'false'
      )) {
      this.directorRouter.setRoute(el.attributes.href.value);
      e.preventDefault();
    }
  }.bind(this), false);

  /**
   * Kick off routing.
   */
  this.directorRouter.init();
};
