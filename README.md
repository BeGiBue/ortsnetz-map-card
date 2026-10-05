# Ortsnetz Map Card

**Version 1.0.2**

HACS-Dashboard-Card zur Darstellung der öffentlichen Messpunkte von [ortsnetz-auslastung.de](https://www.ortsnetz-auslastung.de/) in Home Assistant.

Die Card ist bewusst vom Backend getrennt. HACS verwaltet dieses Repository als **Dashboard-Plugin**; die Messdaten kommen über die separate Home-Assistant-Integration **Ortsnetz Map Backend**.

## Screenshots

| Light Mode | Dark Mode |
|---|---|
| ![Light Mode](screenshots/Tag.png) | ![Dark Mode](screenshots/Nacht.png) |


## Funktionen

- Kartenmittelpunkt standardmäßig am in Home Assistant hinterlegten Standort
- Standard-Zoom 10
- Grafischer Karteneditor in Home Assistant
- Phase für Markerfarbe: automatisch, L1, L2 oder L3
- Einstellbares Aktualisierungsintervall (nur bei sichtbarem Tab; nach Rückkehr in den Tab wird bei Bedarf sofort nachgeladen)
- Optionale Statusanzeige
- Optional eigener Kartenmittelpunkt
- Breite und Höhe ausschließlich über Home Assistants **Layout**-Funktion
- Sections-Layout mit **Full Width**-Option
- Automatischer Dark Mode nach dem aktiven Home-Assistant-Theme
- OpenFreeMap-Vektorkarte (Daten: OpenStreetMap) ohne API-Key
- Farbskala und Grenzwerte aus der Ortsnetz-API
- Popups mit L1/L2/L3, Frequenz, Anzahl Messungen und Zeitstempel
- Veraltete Messwerte werden transparenter dargestellt

## Voraussetzung

Installiere zuerst oder zusätzlich das [Ortsnetz Map Backend](https://github.com/BeGiBue/home-assistant-ortsnetz-map) als HACS-Integration und richte es unter **Einstellungen → Geräte & Dienste** ein.

## Installation über HACS

Automatisch

[![Open your Home Assistant instance and open this repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=BeGiBue&repository=ortsnetz-map-card&category=plugin)

Manuell

1. In HACS **Benutzerdefinierte Repositories** öffnen.
2. Repository-URL hinzufügen und Typ **Dashboard** auswählen.
3. **Ortsnetz Map Card** installieren.
4. Home-Assistant-App bzw. Browser vollständig neu laden.

## Card hinzufügen

Die Card erscheint als **Ortsnetz Map** im Karten-Picker.

Minimal-Konfiguration:

```yaml
type: custom:ortsnetz-map-card
```

## Grafische Konfiguration

Im Karteneditor lassen sich einstellen:

- Zoom
- Markerphase: automatisch / L1 / L2 / L3
- Aktualisierungsintervall
- Statusanzeige
- Home-Assistant-Standort oder eigener Kartenmittelpunkt

**Breite und Höhe werden nicht in der Card konfiguriert.** Sie werden ausschließlich über Home Assistants Tab **Layout** eingestellt.

## Sections / Full Width

Die Card implementiert `getGridOptions()` ohne maximale Spaltenbegrenzung. Dadurch kann Home Assistant neben Rasterbreiten auch die native Option **Full** anbieten. Die Card füllt den zugewiesenen Bereich vollständig aus.

## Dark Mode

Die Card folgt automatisch dem aktiven Home-Assistant-Theme. Primär wird `hass.themes.darkMode` verwendet. Bei einem Theme-Wechsel werden Grundkarte, Bedienelemente, Attribution und Popups entsprechend aktualisiert.

## Daten

Die Card greift nicht direkt auf die externe Messdaten-API zu. Sie verwendet den authentifizierten WebSocket-Endpunkt der Backend-Integration:

```text
ortsnetz_map/get_points
```

Die Card fragt die Daten im eingestellten Intervall an, solange der Browser-Tab sichtbar ist. In einem Hintergrund-Tab wird nicht aktualisiert. Beim Zurückkehren lädt die Card nur nach, wenn die letzten Daten älter als das Intervall sind. Das Backend cached die Messdaten 5 Minuten; mehrere Cards und Browser lösen daher keinen zusätzlichen Abruf bei `ortsnetz-auslastung.de` aus.

## Externe Bibliothek / Karte

- [MapLibre GL JS](https://maplibre.org/) 5.7.1, wird zur Laufzeit von `unpkg.com` geladen
- [OpenFreeMap](https://openfreemap.org/)-Vektorkarten (Stile „Liberty“ für hell, „Dark“ für dunkel) auf Basis von OpenStreetMap-Daten, geladen von `tiles.openfreemap.org`

Für OpenFreeMap wird kein API-Key benötigt. Die erforderliche Attribution bleibt sichtbar. Der Browser muss `unpkg.com` und `tiles.openfreemap.org` erreichen können; die Messdaten selbst laufen ausschließlich über Home Assistant.

## Hinweise

Dieses Projekt ist ein unabhängiges Community-Projekt und nicht Teil von `ortsnetz-auslastung.de`, OpenFreeMap / OpenStreetMap oder Home Assistant.

## Lizenz

GNU Affero General Public License v3.0 only (**AGPL-3.0-only**). Nutzung, Änderungen und Weitergabe sind unter den Bedingungen der AGPL erlaubt; abgeleitete Werke müssen unter derselben Lizenz stehen. Bei modifizierten Versionen, die über ein Netzwerk genutzt werden, muss der entsprechende Quellcode den Nutzern zugänglich gemacht werden. Details stehen in `LICENSE`.
