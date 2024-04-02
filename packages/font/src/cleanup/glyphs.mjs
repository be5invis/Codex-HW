import * as Geom from "@iosevka/geometry";
import { Transform } from "@iosevka/geometry/transform";

///////////////////////////////////////////////////////////////////////////////////////////////////

export function finalizeGlyphs(cache, para, glyphStore) {
	const skew = Math.tan(((para.slopeAngle || 0) / 180) * Math.PI);
	regulateGlyphStore(cache, skew, glyphStore);
	return glyphStore;
}

///////////////////////////////////////////////////////////////////////////////////////////////////

function regulateGlyphStore(cache, skew, glyphStore) {
	for (const g of glyphStore.glyphs()) {
		if (!(g.geometry.measureComplexity() & Geom.CPLX_NON_EMPTY)) continue;
		if (!g.geometry.toReferences()) flattenSimpleGlyph(cache, skew, g);
	}
}

function flattenSimpleGlyph(cache, skew, g) {
	try {
		let gSimplified;
		const needsTransform = g.gizmo ? !Transform.isTranslate(g.gizmo) : skew != 0;
		if (needsTransform) {
			const tfBack = g.gizmo ? g.gizmo.inverse() : new Transform(1, -skew, 0, 1, 0, 0);
			const tfForward = g.gizmo ? g.gizmo : new Transform(1, +skew, 0, 1, 0, 0);
			gSimplified = new Geom.TransformedGeometry(
				tfForward,
				new Geom.SimplifyGeometry(new Geom.TransformedGeometry(tfBack, g.geometry)),
			);
		} else {
			gSimplified = new Geom.SimplifyGeometry(g.geometry);
		}

		const cs = gSimplified.toContours({ cache });
		g.clearGeometry();
		g.includeContours(cs);
	} catch (e) {
		console.error("Detected broken geometry when processing", g._m_identifier);
		throw e;
	}
}
