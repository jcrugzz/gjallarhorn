describe('gjallarhorn', function () {
  'use strict';

  var EventEmitter = require('events').EventEmitter
    , fork = require('child_process').fork
    , Gjallarhorn = require('./')
    , assume = require('assume')
    , path = require('path')
    , fixtures
    , ghorn;

  fixtures = require('fs').readdirSync(path.join(__dirname, 'fixtures'))
  .reduce(function reduce(memo, fixture) {
    memo[fixture.replace('.js', '')] = 1;
    return memo;
  }, {});

  fixtures.idonotexistlolcakes = 1;

  beforeEach(function () {
    ghorn = new Gjallarhorn();

    ghorn.reload(function factory(name) {
      if (!(name in fixtures)) return false;

      return fork(path.join(__dirname, 'fixtures', name +'.js'), {
        silent: true
      });
    });
  });

  afterEach(function () {
    ghorn.destroy();
  });

  it('must accept an options object', function () {
    var g = new Gjallarhorn({ retries: 10,  });

    assume(g.retries).equals(10);
    assume(g.concurrent).equals(256);
  });

  it('can be constructed without `new` keyword', function () {
    assume(Gjallarhorn()).is.instanceOf(Gjallarhorn);
  });

  describe('#reload', function () {
    it('sets a new child process generating factory', function () {
      function factory() {
      }

      assume(ghorn.factory).does.not.equal(factory);
      assume(ghorn.reload(factory)).equals(ghorn);
      assume(ghorn.factory).equals(factory);
    });
  });

  describe('#launch', function () {
    it('returns a boolean as indication if a process is queued', function () {
      ghorn.active = new Array(ghorn.concurrent);

      ghorn.reload(function () {
        return {};
      });

      assume(ghorn.queue).to.have.length(0);
      assume(ghorn.launch({spec: 'here'}, function () {})).equals(false);
      assume(ghorn.queue).to.have.length(1);
    });

    it('does not launch if the factory returns nothing', function (next) {
      next = assume.plan(2, next);

      ghorn.reload(function (spec) {
        assume(spec).equals(1);

        return false;
      });

      assume(ghorn.launch(1, function () {})).equals(false);
      next();
    });

    it('adds a timeout', function () {
      ghorn.launch('messages', function () {});
      assume(ghorn.timers.active((ghorn.ids - 1) +':timeout')).is.true();
    });

    it('receives the send messages as data argument', function (next) {
      ghorn.launch('messages', function (err, data) {
        assume(data).is.a('array');
        assume(data).has.length(2);

        assume(data[0]).deep.equals({ message: 1 });
        assume(data[1]).deep.equals({ message: 2 });

        next();
      });
    });

    it('receives an error if the operation times out', function (next) {
      ghorn.timeout = 200;

      ghorn.launch('timeout', function (err) {
        assume(err.message).includes('timed out');
        assume(err.message).includes('200 ms');

        next();
      });
    });

    it('it retries if the process dies instantly', function (next) {
      ghorn.launch('death', function (err) {
        assume(err.message).includes('failed');
        assume(err.message).includes('retrying');

        next();
      });
    });

    it('it retries if the process dies, slowly', function (next) {
      this.timeout(ghorn.retries * 1200);

      ghorn.launch('slow-death', function (err) {
        assume(err.message).includes('failed');
        assume(err.message).includes('retrying');

        next();
      });
    });

    it('works against non-existing files', function (next) {
      ghorn.launch('idonotexistlolcakes', function (err) {
        assume(err.message).includes('failed');
        assume(err.message).includes('retrying');

        next();
      });
    });

    it('can supply a custom retry option', function (next) {
      ghorn.launch('death', { retries: 5 }, function (err) {
        assume(err.message).includes('failed');
        assume(err.message).includes('retrying');

        next();
      });
    });
  });

  describe('#next', function () {
    it('returns false if nothing can be processed', function () {
      assume(ghorn.next()).is.false();
    });

    it('returns false if active is full', function () {
      ghorn.active = new Array(ghorn.concurrent);
      ghorn.queue.push([0, function () {}]);

      assume(ghorn.next()).is.false();
    });

    it('launches the first of the queue', function (next) {
      var order = [];

      ghorn.active = new Array(ghorn.concurrent);

      ghorn.reload(function () {
        var ee = new EventEmitter();

        setTimeout(function () { ee.emit('exit', 0); }, 10);

        return ee;
      });

      ghorn.launch('foo', function () {
        order.push('first');
      });

      ghorn.launch('foo', function (err) {
        order.push('second');

        assume(order).deep.equals(['first', 'second']);
        next();
      });

      assume(ghorn.queue).is.length(2);
      assume(ghorn.next()).equals(false);

      ghorn.active.length = 0;
      assume(ghorn.next()).equals(true);
    });
  });

  describe('#again', function () {
    it('cannot try again if there are no more retries', function () {
      assume(ghorn.again({ retries: 0 })).equals(false);
    });

    it('clears and re-launches if it can try again', function (next) {
      ghorn.reload(function (spec) {
        assume(spec).equals('lol');
        next();
      });

      assume(ghorn.again({
        fn: function () {},
        retries: 1,
        spec: 'lol'
      })).equals(true);
    });
  });

  describe('#destroy', function () {
    it('returns false when its already destroyed', function () {
      assume(ghorn.destroy()).is.true();
      assume(ghorn.destroy()).is.false();
      assume(ghorn.destroy()).is.false();
      assume(ghorn.destroy()).is.false();
    });

    it('clears all active processes with an cancel error', function (next) {
      ghorn.reload(function () {
        return new EventEmitter();
      });

      ghorn.launch({ payload: 1 }, function (err) {
        assume(err.message).includes('cancel');

        setTimeout(function () {
          assume(ghorn.active).has.length(0);
          assume(ghorn.queue).has.length(0);

          next();
        }, 10);
      });

      assume(ghorn.queue).has.length(0);
      assume(ghorn.active).has.length(1);

      ghorn.destroy();
    });

    it('clears all queued processes with an cancel error', function (next) {
      ghorn.active = new Array(ghorn.concurrent);

      ghorn.launch({ payload: 1 }, function (err) {
        assume(err.message).includes('cancel');

        setTimeout(function () {
          assume(ghorn.queue).has.length(0);
          assume(ghorn.active).has.length(0);

          next();
        }, 10);
      });

      assume(ghorn.queue).has.length(1);

      ghorn.destroy();
    });
  });
});
