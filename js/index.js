/*
 * Credit to generic.sucks for the website code.
 * Images belong to their respective owners.
 * More info can be found at /credit/.
 *
 * Source: https://github.com/Purpzie/sucks
 * Generic.sucks source: https://github.com/memework/generic-sucks
 */
'use strict';

var cnvs = document.querySelector(`canvas`);
var ctx = cnvs.getContext(`2d`);

function resize() {
  cnvs.width = innerWidth;
  cnvs.height = innerHeight;
}

var memes = [];
var cap = 100;
var hyper = false;


function hyperDisable() { // eslint-disable-line no-unused-vars
  hyper = false;
  cap = 250;
  document.querySelector(`#memeplane`).style.animationName = `fly-plane`;
  document.querySelector(`#memeplane`).style.animationDuration = `50ms`;
  document.querySelector(`#memeplane`).style.animationTimingFunction = `ease-in-out`;
}

function draw() {
  ctx.clearRect(0, 0, cnvs.width, cnvs.height);

  if (hyper) {
    let h = (Date.now() / 10) % 360;
    ctx.fillStyle = `hsla(${h}, 100%, 50%, 1)`;
  } else {
    ctx.fillStyle = `#23272A`;
  }
  ctx.fillRect(0, 0, cnvs.width, cnvs.height);

  for (var i = 0; i < memes.length; i++) {
    let meme = memes[i];
    ctx.save();
    ctx.translate(meme.x, meme.y);
    ctx.drawImage(meme.image, meme.x, meme.y, meme.width, meme.height);
    ctx.restore();

    meme.y += meme.speed;
    meme.x -= meme.speed;
  }

  // remove sprites that fall off of the screen
  for (var i = memes.length - 1; i > 0; i--) {
    if (memes[i].y > innerHeight + memes[i].image.height) {
      memes.splice(i, 1);
    }
  }

  // draw again
  requestAnimationFrame(draw);
}

setInterval(function() {
  if (hyper) {
    for (var i = 0; i < 2; i++) {
      spawnMeme();
    }
  } else {
    spawnMeme();
  }
}, 8);

// resize the canvas
resize();
window.addEventListener(`resize`, function() {
  memes = [];
  resize();
});

var images = document.querySelectorAll(`.images img`);

function spawnMeme() {
  // cap at 200 sprites
  if (memes.length > cap) {
    return;
  }

  var far = Math.random();
  if (far > 0.35) far = 0.35;
  var img = images[Math.floor(Math.random() * images.length)];
  var x = Math.floor(Math.random() * innerWidth)*2;
  var y = 0 - img.height * 2;

  memes.push({
    image: img
    , x: x, y: y
    , width: img.width * far
    , height: img.height * far
    , speed: img.width * far / 20
    , rot: Math.random() * 2
  });
}

// draw
draw();
requestAnimationFrame(draw);
