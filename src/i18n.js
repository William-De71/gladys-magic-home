// -----------------------------------------------------------------------------
// Runtime texts, in the four languages of the Gladys UI.
//
// `t(key, vars)` returns a multi-language object `{ en, fr, de, es }`
// (configuration buttons, widgets, connection status); `text(key, language,
// vars)` returns one string (feature names, scene action errors: Gladys does
// not send the language of the user with a scan, a command or a scene
// action, see `language` in config.js).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

const EFFECT_NAMES = {
  effect_rgb_cross_fade: {
    en: 'Red, green, blue fade',
    fr: 'Fondu rouge, vert, bleu',
    de: 'Übergang Rot-Grün-Blau',
    es: 'Fundido rojo-verde-azul',
  },
  effect_colorloop: {
    en: 'Colour loop',
    fr: 'Boucle de couleurs',
    de: 'Farbschleife',
    es: 'Ciclo de colores',
  },
  effect_red_fade: {
    en: 'Red pulse',
    fr: 'Pulsation rouge',
    de: 'Rot pulsierend',
    es: 'Pulso rojo',
  },
  effect_green_fade: {
    en: 'Green pulse',
    fr: 'Pulsation verte',
    de: 'Grün pulsierend',
    es: 'Pulso verde',
  },
  effect_blue_fade: {
    en: 'Blue pulse',
    fr: 'Pulsation bleue',
    de: 'Blau pulsierend',
    es: 'Pulso azul',
  },
  effect_yellow_fade: {
    en: 'Yellow pulse',
    fr: 'Pulsation jaune',
    de: 'Gelb pulsierend',
    es: 'Pulso amarillo',
  },
  effect_cyan_fade: {
    en: 'Cyan pulse',
    fr: 'Pulsation cyan',
    de: 'Cyan pulsierend',
    es: 'Pulso cian',
  },
  effect_purple_fade: {
    en: 'Purple pulse',
    fr: 'Pulsation violette',
    de: 'Lila pulsierend',
    es: 'Pulso morado',
  },
  effect_white_fade: {
    en: 'White pulse',
    fr: 'Pulsation blanche',
    de: 'Weiß pulsierend',
    es: 'Pulso blanco',
  },
  effect_rg_cross_fade: {
    en: 'Red-green fade',
    fr: 'Fondu rouge-vert',
    de: 'Überblendung Rot-Grün',
    es: 'Fundido rojo-verde',
  },
  effect_rb_cross_fade: {
    en: 'Red-blue fade',
    fr: 'Fondu rouge-bleu',
    de: 'Überblendung Rot-Blau',
    es: 'Fundido rojo-azul',
  },
  effect_gb_cross_fade: {
    en: 'Green-blue fade',
    fr: 'Fondu vert-bleu',
    de: 'Überblendung Grün-Blau',
    es: 'Fundido verde-azul',
  },
  effect_colorstrobe: {
    en: 'Colour strobe',
    fr: 'Stroboscope multicolore',
    de: 'Farbstroboskop',
    es: 'Estroboscopio de colores',
  },
  effect_red_strobe: {
    en: 'Red strobe',
    fr: 'Stroboscope rouge',
    de: 'Stroboskop Rot',
    es: 'Estroboscopio rojo',
  },
  effect_green_strobe: {
    en: 'Green strobe',
    fr: 'Stroboscope vert',
    de: 'Stroboskop Grün',
    es: 'Estroboscopio verde',
  },
  effect_blue_strobe: {
    en: 'Blue strobe',
    fr: 'Stroboscope bleu',
    de: 'Stroboskop Blau',
    es: 'Estroboscopio azul',
  },
  effect_yellow_strobe: {
    en: 'Yellow strobe',
    fr: 'Stroboscope jaune',
    de: 'Stroboskop Gelb',
    es: 'Estroboscopio amarillo',
  },
  effect_cyan_strobe: {
    en: 'Cyan strobe',
    fr: 'Stroboscope cyan',
    de: 'Stroboskop Cyan',
    es: 'Estroboscopio cian',
  },
  effect_purple_strobe: {
    en: 'Purple strobe',
    fr: 'Stroboscope violet',
    de: 'Stroboskop Lila',
    es: 'Estroboscopio morado',
  },
  effect_white_strobe: {
    en: 'White strobe',
    fr: 'Stroboscope blanc',
    de: 'Stroboskop Weiß',
    es: 'Estroboscopio blanco',
  },
  effect_colorjump: {
    en: 'Colour jump',
    fr: 'Saut de couleurs',
    de: 'Farbsprung',
    es: 'Salto de colores',
  },
  effect_cycle_rgb: {
    en: 'Red, green, blue cycle',
    fr: 'Cycle rouge, vert, bleu',
    de: 'Zyklus Rot, Grün, Blau',
    es: 'Ciclo rojo, verde, azul',
  },
  effect_cycle_seven_colors: {
    en: 'Seven colour cycle',
    fr: 'Cycle sept couleurs',
    de: 'Siebenfarbzyklus',
    es: 'Ciclo de siete colores',
  },
};

const MESSAGES = {
  // --- Feature names (`<device name> - <feature>`) ---------------------------
  power: { en: 'On/Off', fr: 'Marche/arrêt', de: 'Ein/Aus', es: 'Encendido/apagado' },
  brightness: { en: 'Brightness', fr: 'Luminosité', de: 'Helligkeit', es: 'Brillo' },
  color: { en: 'Colour', fr: 'Couleur', de: 'Farbe', es: 'Color' },
  temperature: {
    en: 'Colour temperature',
    fr: 'Température de couleur',
    de: 'Farbtemperatur',
    es: 'Temperatura de color',
  },

  // --- Connection status (Integrations page) ---------------------------------
  statusConnected: {
    en: '{count} Magic Home device(s) answering on the local network.',
    fr: '{count} appareil(s) Magic Home répondent sur le réseau local.',
    de: '{count} Magic-Home-Gerät(e) antworten im lokalen Netzwerk.',
    es: '{count} dispositivo(s) Magic Home responden en la red local.',
  },
  statusPartial: {
    en: '{count} Magic Home device(s) answering, {missing} not answering: {names}.',
    fr: '{count} appareil(s) Magic Home répondent, {missing} ne répondent pas : {names}.',
    de: '{count} Magic-Home-Gerät(e) antworten, {missing} antworten nicht: {names}.',
    es: '{count} dispositivo(s) Magic Home responden, {missing} no responden: {names}.',
  },
  statusNoDevice: {
    en: 'No Magic Home device found. Check that the devices are on the same network as Gladys, or type their IP addresses in the configuration.',
    fr: 'Aucun appareil Magic Home trouvé. Vérifiez que les appareils sont sur le même réseau que Gladys, ou saisissez leurs adresses IP dans la configuration.',
    de: 'Kein Magic-Home-Gerät gefunden. Prüfen Sie, ob die Geräte im selben Netzwerk wie Gladys sind, oder geben Sie ihre IP-Adressen in der Konfiguration ein.',
    es: 'No se ha encontrado ningún dispositivo Magic Home. Compruebe que los dispositivos están en la misma red que Gladys o introduzca sus direcciones IP en la configuración.',
  },
  statusScanForbidden: {
    en: 'Gladys refused the network discovery: reinstall the integration and accept its network access.',
    fr: 'Gladys a refusé la découverte réseau : réinstallez l’intégration et acceptez son accès au réseau.',
    de: 'Gladys hat die Netzwerkerkennung abgelehnt: Installieren Sie die Integration neu und erlauben Sie ihren Netzwerkzugriff.',
    es: 'Gladys rechazó el descubrimiento de red: reinstale la integración y acepte su acceso a la red.',
  },

  // --- Configuration button ---------------------------------------------------
  testOk: {
    en: '{count} device(s) found: {list}',
    fr: '{count} appareil(s) trouvé(s) : {list}',
    de: '{count} Gerät(e) gefunden: {list}',
    es: '{count} dispositivo(s) encontrado(s): {list}',
  },
  testUnreachable: {
    en: 'not answering',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },

  // --- Errors (commands, scene actions, buttons) ------------------------------
  errorUnknownDevice: {
    en: 'This device is unknown to the Magic Home integration: run a discovery first.',
    fr: 'Cet appareil est inconnu de l’intégration Magic Home : lancez d’abord une découverte.',
    de: 'Dieses Gerät ist der Magic-Home-Integration unbekannt: Starten Sie zuerst eine Suche.',
    es: 'La integración Magic Home no conoce este dispositivo: inicie primero un descubrimiento.',
  },
  errorUnreachable: {
    en: '{name} does not answer ({error}).',
    fr: '{name} ne répond pas ({error}).',
    de: '{name} antwortet nicht ({error}).',
    es: '{name} no responde ({error}).',
  },
  errorUnsupported: {
    en: '{name} cannot do that (model {model}).',
    fr: '{name} ne sait pas faire cela (modèle {model}).',
    de: '{name} kann das nicht (Modell {model}).',
    es: '{name} no puede hacer eso (modelo {model}).',
  },
  errorInvalidColor: {
    en: 'Invalid colour “{value}”: use #RRGGBB, for example #FF0000.',
    fr: 'Couleur « {value} » invalide : utilisez #RRVVBB, par exemple #FF0000.',
    de: 'Ungültige Farbe „{value}“: Verwenden Sie #RRGGBB, zum Beispiel #FF0000.',
    es: 'Color «{value}» no válido: use #RRGGBB, por ejemplo #FF0000.',
  },
  errorUnknownEffect: {
    en: 'Unknown effect “{value}”.',
    fr: 'Effet « {value} » inconnu.',
    de: 'Unbekannter Effekt „{value}“.',
    es: 'Efecto «{value}» desconocido.',
  },

  // --- Widgets ----------------------------------------------------------------
  widgetOnCount: { en: 'On', fr: 'Allumés', de: 'Eingeschaltet', es: 'Encendidos' },
  widgetNoDevice: {
    en: 'No Magic Home device created yet: add them from the Discover tab.',
    fr: 'Aucun appareil Magic Home créé : ajoutez-les depuis l’onglet Découverte.',
    de: 'Noch kein Magic-Home-Gerät angelegt: im Tab Entdecken hinzufügen.',
    es: 'Ningún dispositivo Magic Home creado: añádalos en la pestaña Descubrir.',
  },
  widgetChooseDevice: {
    en: 'Choose a Magic Home light in the settings of this widget.',
    fr: 'Choisissez une lumière Magic Home dans les réglages du widget.',
    de: 'Wählen Sie in den Widget-Einstellungen ein Magic-Home-Licht.',
    es: 'Elija una luz Magic Home en los ajustes del widget.',
  },
  widgetState: { en: 'State', fr: 'État', de: 'Zustand', es: 'Estado' },
  widgetOn: { en: 'On', fr: 'Allumé', de: 'An', es: 'Encendido' },
  widgetOff: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
  widgetUnreachable: {
    en: 'Not answering',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Sin respuesta',
  },
  widgetStatic: { en: 'Steady light', fr: 'Lumière fixe', de: 'Dauerlicht', es: 'Luz fija' },
  widgetCustom: {
    en: 'Custom effect',
    fr: 'Effet personnalisé',
    de: 'Eigener Effekt',
    es: 'Efecto personalizado',
  },
  widgetMusic: { en: 'Music mode', fr: 'Mode musique', de: 'Musikmodus', es: 'Modo música' },
  widgetEffect: { en: 'Effect', fr: 'Effet', de: 'Effekt', es: 'Efecto' },
  widgetMode: { en: 'Mode', fr: 'Mode', de: 'Modus', es: 'Modo' },
  widgetBrightness: { en: 'Brightness', fr: 'Luminosité', de: 'Helligkeit', es: 'Brillo' },
  widgetColor: { en: 'Colour', fr: 'Couleur', de: 'Farbe', es: 'Color' },
  widgetWhite: { en: 'White', fr: 'Blanc', de: 'Weiß', es: 'Blanco' },
  widgetAllOff: { en: 'All off', fr: 'Tout éteindre', de: 'Alle aus', es: 'Apagar todo' },
  widgetRefresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  widgetStop: { en: 'Steady', fr: 'Fixe', de: 'Dauerlicht', es: 'Fija' },
  widgetPowerOn: { en: 'Turn on', fr: 'Allumer', de: 'Einschalten', es: 'Encender' },
  widgetPowerOff: { en: 'Turn off', fr: 'Éteindre', de: 'Ausschalten', es: 'Apagar' },
  widgetNoEffects: {
    en: 'No built-in effects on this model: on, off and brightness only.',
    fr: 'Pas d’effets intégrés sur ce modèle : marche, arrêt et luminosité.',
    de: 'Keine eingebauten Effekte bei diesem Modell: nur Ein, Aus, Helligkeit.',
    es: 'Este modelo no tiene efectos integrados: solo encendido, apagado, brillo.',
  },
  widgetAllOffDone: {
    en: '{count} device(s) turned off.',
    fr: '{count} appareil(s) éteint(s).',
    de: '{count} Gerät(e) ausgeschaltet.',
    es: '{count} dispositivo(s) apagado(s).',
  },
  widgetRefreshed: { en: 'Refreshed.', fr: 'Actualisé.', de: 'Aktualisiert.', es: 'Actualizado.' },
  widgetTooSoon: {
    en: 'Just refreshed, try again in a few seconds.',
    fr: 'Actualisé à l’instant, réessayez dans quelques secondes.',
    de: 'Gerade aktualisiert, versuchen Sie es in einigen Sekunden erneut.',
    es: 'Acaba de actualizarse, inténtelo de nuevo en unos segundos.',
  },
  widgetEffectStarted: {
    en: '{effect} started.',
    fr: '{effect} lancé.',
    de: '{effect} gestartet.',
    es: '{effect} iniciado.',
  },
  widgetDone: { en: 'Done.', fr: 'C’est fait.', de: 'Erledigt.', es: 'Hecho.' },
  ...EFFECT_NAMES,
};

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] === undefined || vars[name] === null ? match : String(vars[name]),
  );
}

/**
 * @description A runtime text in the four languages.
 * @param {string} key - Message key.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {{en: string, fr: string, de: string, es: string}} The message.
 */
export function t(key, vars = {}) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, text(key, language, vars)]));
}

/**
 * @description A runtime text in one language (English when unknown).
 * @param {string} key - Message key.
 * @param {string} language - Language code.
 * @param {object} [vars] - Placeholder values, a value may itself be multi-language.
 * @returns {string} The text.
 */
export function text(key, language, vars = {}) {
  const message = MESSAGES[key];
  if (!message) {
    throw new Error(`Unknown message ${key}`);
  }
  const lang = LANGUAGES.includes(language) ? language : 'en';
  const resolved = Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [name, pick(value, lang)]),
  );
  return fill(message[lang], resolved);
}

/**
 * @description The name of a feature in one language.
 * @param {string} key - Feature key.
 * @param {string} language - Language code.
 * @returns {string} The name.
 */
export function featureName(key, language) {
  return MESSAGES[key] ? text(key, language) : key;
}

/**
 * @description The name of an effect in the four languages.
 * @param {string} effect - EFFECTS key.
 * @returns {object} `{ en, fr, de, es }`.
 */
export const effectName = (effect) => t(`effect_${effect}`);

/**
 * @description One language of a value that may be multi-language.
 * @param {*} value - A string, a number or `{ en, fr, ... }`.
 * @param {string} language - Language code.
 * @returns {*} The value in that language.
 */
export function pick(value, language) {
  if (value && typeof value === 'object') {
    return value[language] ?? value.en;
  }
  return value;
}

/**
 * @description Cut a text to a maximum length, with an ellipsis.
 * @param {string} value - The text.
 * @param {number} max - Maximum length.
 * @returns {string} The text, at most `max` characters.
 */
export function truncate(value, max) {
  const string = String(value ?? '');
  return string.length <= max ? string : `${string.slice(0, max - 1).trimEnd()}…`;
}

/**
 * @description Cut every language of a multi-language text.
 * @param {object} message - `{ en, fr, ... }`.
 * @param {number} max - Maximum length.
 * @returns {object} The message.
 */
export function truncateAll(message, max) {
  return Object.fromEntries(
    Object.entries(message).map(([language, value]) => [language, truncate(value, max)]),
  );
}

export const MESSAGE_KEYS = Object.keys(MESSAGES);
export const MESSAGES_FOR_TESTS = MESSAGES;
