// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

let isDmMonoNerdLoaded = false;
let is1984BodyLoaded = false;
let isDepartureMonoLoaded = false;
let isHackNerdMonoLoaded = false;

function addToFontFaceSet(fontFaceSet: FontFaceSet, fontFace: FontFace) {
    // any cast to work around typing issue
    (fontFaceSet as any).add(fontFace);
}

function loadDmMonoNerdFont() {
    if (isDmMonoNerdLoaded) {
        return;
    }
    isDmMonoNerdLoaded = true;
    const dmMonoLight = new FontFace("DMMono Nerd Font", "url('fonts/dm-mono-light-nerd.ttf')", {
        style: "normal",
        weight: "300",
    });
    const dmMonoRegular = new FontFace("DMMono Nerd Font", "url('fonts/dm-mono-regular-nerd.ttf')", {
        style: "normal",
        weight: "400",
    });
    const dmMonoMedium = new FontFace("DMMono Nerd Font", "url('fonts/dm-mono-medium-nerd.ttf')", {
        style: "normal",
        weight: "500",
    });
    const dmMonoLightItalic = new FontFace("DMMono Nerd Font", "url('fonts/dm-mono-light-italic-nerd.ttf')", {
        style: "italic",
        weight: "300",
    });
    const dmMonoItalic = new FontFace("DMMono Nerd Font", "url('fonts/dm-mono-italic-nerd.ttf')", {
        style: "italic",
        weight: "400",
    });
    const dmMonoMediumItalic = new FontFace(
        "DMMono Nerd Font",
        "url('fonts/dm-mono-medium-italic-nerd.ttf')",
        {
            style: "italic",
            weight: "500",
        }
    );
    addToFontFaceSet(document.fonts, dmMonoLight);
    addToFontFaceSet(document.fonts, dmMonoRegular);
    addToFontFaceSet(document.fonts, dmMonoMedium);
    addToFontFaceSet(document.fonts, dmMonoLightItalic);
    addToFontFaceSet(document.fonts, dmMonoItalic);
    addToFontFaceSet(document.fonts, dmMonoMediumItalic);
    dmMonoLight.load();
    dmMonoRegular.load();
    dmMonoMedium.load();
    dmMonoLightItalic.load();
    dmMonoItalic.load();
    dmMonoMediumItalic.load();
}

function load1984BodyFont() {
    if (is1984BodyLoaded) {
        return;
    }
    is1984BodyLoaded = true;
    const bodyLight = new FontFace("1984 Body", "url('fonts/1984-body-light.otf')", {
        style: "normal",
        weight: "300",
    });
    const bodyRegular = new FontFace("1984 Body", "url('fonts/1984-body-regular.otf')", {
        style: "normal",
        weight: "400",
    });
    const bodyBold = new FontFace("1984 Body", "url('fonts/1984-body-bold.otf')", {
        style: "normal",
        weight: "700",
    });
    addToFontFaceSet(document.fonts, bodyLight);
    addToFontFaceSet(document.fonts, bodyRegular);
    addToFontFaceSet(document.fonts, bodyBold);
    bodyLight.load();
    bodyRegular.load();
    bodyBold.load();
}

function loadDepartureMonoFont() {
    if (isDepartureMonoLoaded) {
        return;
    }
    isDepartureMonoLoaded = true;
    const departureMono = new FontFace("Departure Mono", "url('fonts/departure-mono-regular.otf')", {
        style: "normal",
        weight: "400",
    });
    addToFontFaceSet(document.fonts, departureMono);
    departureMono.load();
}

function loadHackNerdMonoFont() {
    if (isHackNerdMonoLoaded) {
        return;
    }
    isHackNerdMonoLoaded = true;
    const hackRegular = new FontFace("Hack Nerd Font Mono", "url('fonts/hacknerdmono-regular.ttf')", {
        style: "normal",
        weight: "400",
    });
    const hackBold = new FontFace("Hack Nerd Font Mono", "url('fonts/hacknerdmono-bold.ttf')", {
        style: "normal",
        weight: "700",
    });
    const hackItalic = new FontFace("Hack Nerd Font Mono", "url('fonts/hacknerdmono-italic.ttf')", {
        style: "italic",
        weight: "400",
    });
    const hackBoldItalic = new FontFace("Hack Nerd Font Mono", "url('fonts/hacknerdmono-bolditalic.ttf')", {
        style: "italic",
        weight: "700",
    });
    addToFontFaceSet(document.fonts, hackRegular);
    addToFontFaceSet(document.fonts, hackBold);
    addToFontFaceSet(document.fonts, hackItalic);
    addToFontFaceSet(document.fonts, hackBoldItalic);
    hackRegular.load();
    hackBold.load();
    hackItalic.load();
    hackBoldItalic.load();
}

function loadFonts() {
    load1984BodyFont();
    loadDmMonoNerdFont();
    loadDepartureMonoFont();
    loadHackNerdMonoFont();
}

export { loadFonts };
