import { DiSpiroGeometry, SpiroGeometry } from "@iosevka/geometry";
import {
	BiKnotCollector,
	Interpolator,
	TerminateInstruction,
	UserControlKnot,
} from "@iosevka/geometry/spiro-control";
import { bez3, fallback, mix } from "@iosevka/util";

///////////////////////////////////////////////////////////////////////////////////////////////////

class SpiroImplBase {
	constructor(bindings, args) {
		this.bindings = bindings;
		this.args = args;
	}

	createCollector(glyph) {
		const gizmo = glyph.gizmo || this.bindings.GlobalTransform;

		const collector = new BiKnotCollector(this.bindings.Contrast);
		for (const control of this.args) collector.add(control);
		collector.unwrap();

		return { gizmo, collector };
	}
}

class DispiroImpl extends SpiroImplBase {
	constructor(bindings, args) {
		super(bindings, args);
	}
	applyToGlyph(glyph) {
		const { gizmo, collector } = this.createCollector(glyph);
		const dsp = new DiSpiroProxy(gizmo, collector);
		glyph.includeGeometry(dsp.geometry);
		return dsp;
	}
}
class SpiroOutlineImpl extends SpiroImplBase {
	constructor(bindings, args) {
		super(bindings, args);
	}
	applyToGlyph(glyph) {
		const { gizmo, collector } = this.createCollector(glyph);
		return glyph.includeGeometry(
			new SpiroGeometry(
				gizmo,
				collector.closed,
				collector.controls.map(k => k.toMono()),
			),
		);
	}
}
class DiSpiroProxy {
	constructor(gizmo, collector) {
		this.geometry = new DiSpiroGeometry(
			gizmo,
			collector.contrast,
			collector.closed,
			collector.controls,
		);
		this.m_origKnots = collector.controls;
	}
	get knots() {
		return this.m_origKnots;
	}
	get lhsKnots() {
		return this.geometry.expand().lhsUntransformed;
	}
	get rhsKnots() {
		return this.geometry.expand().rhsUntransformed;
	}
}

/// The builder for directed knot pairs
class DirectedKnotPairBuilder {
	constructor(bindings, prevKnotType, nextKnotType, deltaX, deltaY) {
		const { TINY } = bindings;
		this.start = DirPairImpl(prevKnotType, nextKnotType, deltaX, deltaY, 0, TINY);
		this.mid = DirPairImpl(prevKnotType, nextKnotType, deltaX, deltaY, -0.5 * TINY, 0.5 * TINY);
		this.end = DirPairImpl(prevKnotType, nextKnotType, deltaX, deltaY, -TINY, 0);
	}
}

function DirPairImpl(prevKnotType, nextKnotType, dirX, dirY, distPre, distPost) {
	const fnPre = (x, y, af) => prevKnotType(x + dirX * distPre, y + dirY * distPre, af);
	const fnPost = (x, y, af) => nextKnotType(x + dirX * distPost, y + dirY * distPost, af);
	let buildFn = (x, y, af) => [fnPre(x, y, af), fnPost(x, y, af)];
	buildFn.pre = fnPre;
	buildFn.post = fnPost;
	return buildFn;
}

function KnotType(type) {
	return (x, y, f) => {
		if (!isFinite(x)) throw new TypeError("NaN detected for X");
		if (!isFinite(y)) throw new TypeError("NaN detected for Y");
		return new UserControlKnot(type, x, y, f);
	};
}

export function SetupBuilders(bindings) {
	const { Stroke, Superness } = bindings;

	// Simple knot types
	const g4 = KnotType("g4");
	const g2 = KnotType("g2");
	const corner = KnotType("corner");
	const flat = KnotType("left");
	const curl = KnotType("right");
	const close = f => new TerminateInstruction("close", f);
	const end = f => new TerminateInstruction("end", f);

	// Pair knots
	const straight = { l: flat, r: curl };
	const g2c = { l: g2, r: corner };
	const cg2 = { l: corner, r: g2 };
	const flatc = { l: flat, r: corner };
	const ccurl = { l: corner, r: curl };

	// Add the directed/heading knot builders
	{
		let knotTypes = [
			[g4, g4, g4],
			[g2, g2, g2],
			[corner, corner, corner],
			[straight, flat, curl],
			[g2c, g2, corner],
			[cg2, corner, g2],
			[flatc, flat, corner],
			[ccurl, corner, curl],
		];
		let directions = [
			// Straights
			{ name: "up", x: 0, y: 1 },
			{ name: "down", x: 0, y: -1 },
			{ name: "left", x: -1, y: 0 },
			{ name: "right", x: 1, y: 0 },
			{ name: "u", x: 0, y: 1 },
			{ name: "d", x: 0, y: -1 },
			{ name: "l", x: -1, y: 0 },
			{ name: "r", x: 1, y: 0 },

			// Diagonals
			{ name: "ru", x: 1, y: 1 },
			{ name: "rd", x: 1, y: -1 },
			{ name: "lu", x: -1, y: 1 },
			{ name: "ld", x: -1, y: -1 },
		];
		for (const [sink, kl, kr] of knotTypes) {
			sink.sl = s => new DirectedKnotPairBuilder(bindings, kl, kr, -1, s);
			sink.sr = s => new DirectedKnotPairBuilder(bindings, kl, kr, 1, s);
			sink.dir = (dx, dy) => new DirectedKnotPairBuilder(bindings, kl, kr, dx, dy);
			for (const d of directions) {
				sink[d.name] = new DirectedKnotPairBuilder(bindings, kl, kr, d.x, d.y);
			}
		}
	}

	function widths(l, r) {
		if (!isFinite(l)) throw new TypeError("NaN detected for left width");
		if (!isFinite(r)) throw new TypeError("NaN detected for right width");
		return function () {
			if (this.setWidth) this.setWidth(l, r);
		};
	}
	widths.lhs = function (w) {
		w = fallback(w, Stroke);
		if (!isFinite(w)) throw new TypeError("NaN detected for left width");
		return widths(w, 0);
	};
	widths.rhs = function (w) {
		w = fallback(w, Stroke);
		if (!isFinite(w)) throw new TypeError("NaN detected for left width");
		return widths(0, w);
	};
	widths.center = function (w) {
		w = fallback(w, Stroke);
		if (!isFinite(w)) throw new TypeError("NaN detected for left width");
		return widths(w / 2, w / 2);
	};

	function heading(d) {
		if (!isFinite(d.x) || !isFinite(d.y))
			throw new TypeError("NaN detected for heading directions");
		return function () {
			if (this.headsTo) this.headsTo(d);
		};
	}
	widths.heading = function (l, r, d) {
		if (!isFinite(l)) throw new TypeError("NaN detected for left width");
		if (!isFinite(r)) throw new TypeError("NaN detected for left width");
		if (!isFinite(d.x) || !isFinite(d.y))
			throw new TypeError("NaN detected for heading directions");
		return function () {
			if (this.setWidth) this.setWidth(l, r);
			if (this.headsTo) this.headsTo(d);
		};
	};
	widths.lhs.heading = function (w, d) {
		w = fallback(w, Stroke);
		if (!isFinite(w)) throw new TypeError("NaN detected for left width");
		if (!isFinite(d.x) || !isFinite(d.y))
			throw new TypeError("NaN detected for heading directions");
		return function () {
			if (this.setWidth) this.setWidth(w, 0);
			if (this.headsTo) this.headsTo(d);
		};
	};
	widths.rhs.heading = function (w, d) {
		w = fallback(w, Stroke);
		if (!isFinite(w)) throw new TypeError("NaN detected for left width");
		if (!isFinite(d.x) || !isFinite(d.y))
			throw new TypeError("NaN detected for heading directions");
		return function () {
			if (this.setWidth) this.setWidth(0, w);
			if (this.headsTo) this.headsTo(d);
		};
	};
	widths.center.heading = function (w, d) {
		w = fallback(w, Stroke);
		if (!isFinite(w)) throw new TypeError("NaN detected for left width");
		if (!isFinite(d.x) || !isFinite(d.y))
			throw new TypeError("NaN detected for heading directions");
		return function () {
			if (this.setWidth) this.setWidth(w / 2, w / 2);
			if (this.headsTo) this.headsTo(d);
		};
	};

	function disableContrast() {
		return function () {
			if (this.setContrast) this.setContrast(1);
		};
	}
	function unimportant() {
		if (this.setUnimportant) this.setUnimportant(1);
	}
	function important() {
		return void 0;
	}

	function afInterpolate(before, after, args) {
		return g4(
			mix(before.x, after.x, args.rx),
			mix(before.y, after.y, args.ry),
			fallback(args.raf, unimportant),
		);
	}
	function afInterpolateDelta(before, after, args) {
		return g4(
			mix(before.x, after.x, args.rx) + args.deltaX,
			mix(before.y, after.y, args.ry) + args.deltaY,
			fallback(args.raf, unimportant),
		);
	}
	function afInterpolateG2(before, after, args) {
		return g2(
			mix(before.x, after.x, args.rx),
			mix(before.y, after.y, args.ry),
			fallback(args.raf, unimportant),
		);
	}
	function afInterpolateThem(before, after, args) {
		let innerKnots = [];
		for (const [rx, ry, rt] of args.rs) {
			innerKnots.push(
				fallback(args.ty, g2)(
					mix(before.x, after.x, rx),
					mix(before.y, after.y, ry),
					args.raf && args.raf.blend && rt !== void 0
						? args.raf.blend(rt)
						: args.raf
							? args.raf
							: unimportant,
				),
			);
		}
		return innerKnots;
	}
	function afInterpolateThemWithDelta(before, after, args) {
		let innerKnots = [];
		for (const [rx, ry, deltaX, deltaY, rt] of args.rs) {
			innerKnots.push(
				fallback(args.ty, g2)(
					mix(before.x, after.x, rx) + deltaX,
					mix(before.y, after.y, ry) + deltaY,
					args.raf && args.raf.blend && rt !== void 0
						? args.raf.blend(rt)
						: args.raf
							? args.raf
							: unimportant,
				),
			);
		}
		return innerKnots;
	}
	function afInterpolateThemFromTWithDelta(before, after, args) {
		let innerKnots = [];
		for (const rt of args.rs) {
			innerKnots.push(
				fallback(args.ty, g2)(
					mix(before.x, after.x, args.raf.rx(rt)) + args.raf.deltaX(rt),
					mix(before.y, after.y, args.raf.ry(rt)) + args.raf.deltaY(rt),
					args.raf.modifier(rt),
				),
			);
		}
		return innerKnots;
	}

	function alsoThru(rx, ry, raf) {
		return Interpolator(afInterpolate, { rx, ry, raf });
	}
	alsoThru.withOffset = function (rx, ry, deltaX, deltaY, raf) {
		return Interpolator(afInterpolateDelta, { rx, ry, deltaX, deltaY, raf });
	};
	alsoThru.g2 = function (rx, ry, raf) {
		return Interpolator(afInterpolateG2, { rx, ry, raf });
	};
	function alsoThruThem(rs, raf, ty) {
		return Interpolator(afInterpolateThem, { rs, raf, ty });
	}
	alsoThruThem.withOffset = function (rs, raf, ty) {
		return Interpolator(afInterpolateThemWithDelta, { rs, raf, ty });
	};
	alsoThruThem.fromTWithOffset = function (rs, raf, ty) {
		return Interpolator(afInterpolateThemFromTWithDelta, { rs, raf, ty });
	};

	function bezControlsImpl(x1, y1, x2, y2, samples, raf, ty) {
		let rs = [];
		for (let j = 1; j < samples; j = j + 1)
			rs.push([
				bez3(0, x1, x2, 1, j / samples),
				bez3(0, y1, y2, 1, j / samples),
				j / samples,
			]);
		return alsoThruThem(rs, raf);
	}
	function bezControls(x1, y1, x2, y2, _samples, raf) {
		return bezControlsImpl(x1, y1, x2, y2, fallback(_samples, 3), raf);
	}
	function quadControls(x1, y1, _samples, raf) {
		return bezControlsImpl(
			(x1 * 2) / 3,
			(y1 * 2) / 3,
			mix(1, x1, 2 / 3),
			mix(1, y1, 2 / 3),
			fallback(_samples, 3),
			raf,
		);
	}

	let DEFAULT_STEPS = 6;
	let [buildHV, buildVH] = (function (cache) {
		function build(samples, _superness) {
			const superness = fallback(_superness, Superness);
			let hv = [];
			let vh = [];
			for (let j = 1; j < samples; j = j + 1) {
				const theta = (((j + 1) / (samples + 2)) * Math.PI) / 2;
				const c = Math.pow(Math.cos(theta), 2 / superness);
				const s = Math.pow(Math.sin(theta), 2 / superness);
				hv.push([s, 1 - c]);
				vh.push([1 - c, s]);
			}
			return { hv, vh: vh };
		}
		function buildHVImpl(samples, _superness) {
			if (_superness) return build(samples, _superness).hv;
			if (!cache[samples]) cache[samples] = build(samples, _superness);
			return cache[samples].hv;
		}
		function buildVHImpl(samples, _superness) {
			if (_superness) return build(samples, _superness).vh;
			if (!cache[samples]) cache[samples] = build(samples, _superness);
			return cache[samples].vh;
		}
		return [buildHVImpl, buildVHImpl];
	})([]);
	function archv(samples, superness) {
		return alsoThruThem(buildHV(fallback(samples, DEFAULT_STEPS), superness));
	}
	archv.superness = function (s) {
		return archv(DEFAULT_STEPS, s);
	};
	function arcvh(samples, superness) {
		return alsoThruThem(buildVH(fallback(samples, DEFAULT_STEPS), superness));
	}
	arcvh.superness = function (s) {
		return arcvh(DEFAULT_STEPS, s);
	};
	archv.yFromX = function (px, _s) {
		const s = fallback(_s, Superness);
		return 1 - Math.pow(1 - Math.pow(px, s), 1 / s);
	};

	function dispiro(...args) {
		return new DispiroImpl(bindings, args);
	}
	function spiroOutline(...args) {
		return new SpiroOutlineImpl(bindings, args);
	}
	function spiroCollect(glyph, ...args) {
		const spb = new SpiroImplBase(bindings, args);
		return spb.createCollector(glyph);
	}

	return {
		g4,
		g2,
		corner,
		flat,
		curl,
		close,
		end,
		straight,
		g2c,
		cg2,
		flatc,
		ccurl,
		widths,
		heading,
		"disable-contrast": disableContrast,
		unimportant,
		important,
		alsoThru,
		alsoThruThem,
		bezControls,
		quadControls,
		archv,
		arcvh,
		dispiro,
		"spiro-outline": spiroOutline,
		"spiro-collect": spiroCollect,
	};
}
