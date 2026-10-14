# Magic Home

## Überblick

Diese Integration bringt Ihre **Magic-Home**-WLAN-Geräte zu Gladys: Farb- und Weißlichtlampen, LED-Streifen-Controller, CCT- und dimmbare Leuchten, adressierbare Streifen, Lichterketten, Steckdosen und Schalter — die mit den Apps Magic Home Pro, Zengge oder Surplife eingerichteten Geräte. Sie schalten sie ein und aus, stellen Farbe, Weiß und Helligkeit im Dashboard ein, starten ihre eingebauten Effekte aus Ihren Szenen, und Ihre Szenen erfahren, wenn ein Gerät nicht mehr antwortet.

Alles bleibt in Ihrem **lokalen Netzwerk**: kein Konto, keine Cloud, nichts verlässt Ihr Zuhause. Gladys findet die Geräte selbst mit der Suche der Magic-Home-App (UDP-Port 48899), danach spricht die Integration direkt mit jedem Gerät (TCP-Port 5577).

## Voraussetzungen

- Gladys Assistant 5.1.1 oder neuer.
- Mit der App Magic Home Pro (oder Zengge, Surplife…) eingerichtete Geräte im **selben Netzwerk wie Gladys**. Ein Gastnetz oder ein Router, der WLAN-Clients isoliert, blockiert sie.
- Erlauben Sie auf dem Installationsbildschirm die **Netzwerkerkennung** (UDP-Port 48899): Mit ihr findet Gladys die Geräte.

## Konfiguration

### Suche

In den meisten Haushalten ist nichts auszufüllen: Drücken Sie **Geräte suchen und testen**. Die Meldung listet jedes gefundene Gerät mit Adresse, Modell und Erreichbarkeit auf.

Ein Gerät, das die Suche nicht findet (anderes Subnetz, Netzwerk, das Broadcasts filtert): Geben Sie seine Adresse unter **IP-Adressen** ein, durch Kommas getrennt, und speichern Sie.

Geben Sie jedem Gerät im Router eine **feste IP-Adresse**: Die Integration findet ein Gerät mit geänderter Adresse wieder (an seiner MAC-Adresse), mit fester Adresse aber schneller.

### Aktualisierung und Sprache

- **Zustandsaktualisierung**: Jedes Gerät wird alle 10 Sekunden, 30 Sekunden (Standard) oder 1 Minute abgefragt. Die meisten Geräte melden Änderungen außerdem sofort (Fernbedienung, Magic-Home-App).
- **Automatische Suche**: Das Netzwerk wird jede Stunde (Standard), alle 15 Minuten oder nie erneut durchsucht; ein Gerät, das nicht mehr antwortet, löst ohnehin eine Suche aus.
- **Sprache der Gerätetexte**: Die Funktionsnamen im Tab Entdecken und die Fehlermeldungen der Szenen werden in dieser Sprache geschrieben, da Gladys Ihre Sprache nicht mitsendet.

## Verwendung

### Geräte

Öffnen Sie den Tab **Entdecken** der Integration: Jedes gefundene Gerät wird mit den Funktionen aufgelistet, die sein Modell und seine Verdrahtung bieten. Fügen Sie die gewünschten hinzu und benennen Sie sie nach Belieben um.

- Farb- und Weißlichtlampen, RGB&CCT-Controller: **Ein/Aus**, **Helligkeit**, **Farbe**, **Farbtemperatur**.
- RGB-, RGBW- und RGB/W-Controller und -Lampen, adressierbare Streifen, Lichterketten: **Ein/Aus**, **Helligkeit**, **Farbe** (eine weiße Farbe schaltet die weißen LEDs eines RGB+W-Geräts).
- CCT-Lampen und -Controller: **Ein/Aus**, **Helligkeit**, **Farbtemperatur**.
- Einfarbige Controller, dimmbare Lampen: **Ein/Aus**, **Helligkeit**.
- Steckdosen und Schalter: **Ein/Aus**.

Farbe und Weiß sind Alternativen: Eine Farbe schaltet die Farb-LEDs, eine Temperatur die weißen LEDs, wie in der Magic-Home-App. Jedes Gerät zeigt ein Badge **lokal** oder **nicht erreichbar**, wenn es nicht antwortet.

### Widgets

![Die Widgets „Magic-Home-Lichter“ und „Magic-Home-Effekte“: fünf Geräte mit Zustand und Helligkeit, die Wohnzimmerlampe spielt die Farbschleife, mit ihren Effekttasten (generierte Illustration, kein Screenshot)](https://raw.githubusercontent.com/William-De71/gladys-magic-home/main/docs/assets/widgets.de.png)

- **Magic-Home-Lichter**: wie viele Geräte an sind, wie viele nicht antworten, jedes Gerät mit Zustand, Helligkeit und dem, was es spielt, eine Schaltfläche **Alle aus** (mit Bestätigung) und **Aktualisieren**. Einstellung: alle Geräte oder nur eingeschaltete.
- **Magic-Home-Effekte**: ein in den Einstellungen gewähltes Licht, sein Zustand, Modus und seine Helligkeit, eine Ein/Aus-Taste und drei Effekttasten, die Sie in den Einstellungen wählen (mit ihrer Geschwindigkeit). Während ein Effekt läuft, wird die dritte Taste zu **Dauerlicht**.

### Szenen-Auslöser

- **Ein Magic-Home-Gerät antwortet nicht mehr**: ausgesteckt, am Wandschalter aus oder seit über 30 Sekunden ohne WLAN.
- **Ein Magic-Home-Gerät antwortet wieder**: nachdem es nicht antwortete.

Beide lassen sich auf ein Gerät beschränken und geben der Szene `device_name` und `ip`.

### Szenen-Aktionen

- **Magic-Home-Effekt starten**: einer der 23 eingebauten Effekte (Farbschleife, Sprünge, Pulsieren, Stroboskope…), seine Geschwindigkeit und, bei neueren Firmwares, seine Helligkeit.
- **Magic-Home-Farben abspielen**: bis zu 16 Farben nach Wahl (`#FF0000, #0000FF`), als Überblenden, Sprung oder Stroboskop.
- **Magic-Home-Licht blinken lassen**: lässt eine Farbe 1 bis 60 Sekunden blinken, danach kehrt das Licht in seinen vorherigen Zustand zurück (Farbe, Weiß, Effekt oder aus).
- **Magic-Home-Effekt beenden**: zurück zur letzten festen Farbe oder zum letzten Weiß.

### Szenenbeispiele

- Wenn es an der Tür klingelt → **Magic-Home-Licht blinken lassen**, 5 Sekunden rot an der Wohnzimmerlampe.
- Wenn das Gartenlicht nicht mehr antwortet → sich eine Nachricht senden: Es wurde am Wandschalter ausgeschaltet.
- Jeden Abend bei Sonnenuntergang → Küchenstreifen auf 40 %, dann **Magic-Home-Farben abspielen** `#FF6A00, #FF0040` als langsames Überblenden am Wohnzimmerstreifen.

## Fehlerbehebung

- **Kein Gerät gefunden**: Prüfen Sie, ob das Gerät in der Magic-Home-App **über WLAN** antwortet (nicht über die Cloud von unterwegs), im selben Netzwerk wie Gladys ist und der Router WLAN-Clients nicht isoliert. Andernfalls geben Sie seine IP-Adresse in der Konfiguration ein.
- **„Gladys hat die Netzwerkerkennung abgelehnt“**: Installieren Sie die Integration neu und erlauben Sie auf dem Installationsbildschirm ihren Netzwerkzugriff.
- **Ein Gerät ist „Nicht erreichbar“**: Es ist ausgesteckt, am Wandschalter aus oder ohne WLAN. Hat sich seine Adresse geändert, findet die nächste Suche es wieder; drücken Sie **Geräte suchen und testen**, um sofort zu suchen.
- **Ein Effekt startet nicht**: Steckdosen, reine Weißlichtgeräte und adressierbare Streifen haben in dieser Integration keine eingebauten Effekte; einige Effekte gibt es nur bei neueren Firmwares.
- **Eine Funktion fehlt oder ist falsch**: Die Funktionen folgen Modell und Verdrahtung, die das Gerät meldet (sein Parameter `MAGICHOME_MODEL`). Eröffnen Sie ein Issue auf GitHub mit diesem Parameter, den Versionen von Gladys und der Integration sowie den Logs (Tab Logs der Integration).
