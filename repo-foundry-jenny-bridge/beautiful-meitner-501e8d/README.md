# Jenny Foundry Bridge

Eigenes Foundry-VTT-Repository fuer die Gegenseite des Jenny-Bots.

## Ziel

Dieses Modul kapselt die Foundry-Seite der Integration:

- `roll`
- `character`
- `campaignInfo`
- `initiative`
- `journal`
- Routing-Hinweise fuer externe Charaktere wie DnDBeyond
- Weltbezogene Einstellungen wie `channelKey` und `sharedSecret`
- Polling-Worker fuer die Bot-Bridge
- In-Foundry-GM-Panel fuer direktes Spielen ueber den Bot-Kanal

## Aktueller Transport

Das Modul implementiert jetzt den Polling-Transport direkt:

1. GM-Client pollt den Bot unter `/foundry-bridge/poll`
2. Bot liefert die naechste ausstehende Anfrage fuer `channelKey`
3. Foundry fuehrt `roll`, `character` oder `campaignInfo` aus
4. Ergebnis geht per `POST /foundry-bridge/result` zurueck

Voraussetzungen:

- Der Bot muss ueber HTTP erreichbar sein
- `Bot base URL` muss auf den Jenny-API-Host zeigen, z. B. `https://xbullseyegaming.de`
- `Shared secret` muss mit `FOUNDRY_PLUGIN_SECRET` auf Bot-Seite uebereinstimmen
- Mindestens ein GM muss mit aktivem Modul im World-Client verbunden sein

Fuer das In-Foundry-GM-Panel zusaetzlich:

- `Bot API secret` muss den Bearer fuer den Bot-API-Flow enthalten
- `Play channel ID` muss auf den dafuer vorgesehenen Bot-Kanal zeigen, z. B. `foundry`

## Secrets und Key Manager

Bot-Seite und Foundry-Seite sind hier bewusst unterschiedlich:

- Auf Bot-Seite werden Secret-Aliase ueber `getSecret(...)` aufgeloest.
- Auf Foundry-Seite gibt es diesen Bot-Mechanismus nicht.
- Deshalb erwartet das Foundry-Modul in seinen Einstellungen die echten Secret-Werte, nicht die Alias-Namen.

Aktuell auf Bot-Seite verwendet:

- `FOUNDRY_PLUGIN_SECRET`
  - wird in `repo-codex/core.json` unter `workingObject.toolsconfig.getFoundryBridge.apiSecret` referenziert
  - wird im Bot ueber `getSecret(...)` aufgeloest
  - schuetzt `/foundry-bridge/poll` und `/foundry-bridge/result`

- `API_SECRET`
  - schuetzt den normalen Bot-API-Flow `/api` und `/context`
  - wird im Bot ebenfalls ueber `getSecret(...)` aufgeloest

Das heisst praktisch:

1. Diese Alias-Namen muessen im Bot-Key-Manager bzw. Secret-Store existieren:
   - `FOUNDRY_PLUGIN_SECRET`
   - `API_SECRET`
2. Im Foundry-Modul traegst du nicht die Namen `FOUNDRY_PLUGIN_SECRET` oder `API_SECRET` ein.
3. Stattdessen traegst du die echten Werte ein, die hinter diesen Aliasen liegen.

## Wichtiger Architekturhinweis

Die aktuelle Foundry-Modulentwicklung ist clientseitig organisiert: Module liefern `module.json`, ESM-Skripte und koennen laut offizieller Doku ueber `socket: true` einen Modul-Socket verwenden. Die offiziellen Unterlagen beschreiben dabei Modul-Manifest, ESModules und Modul-Sockets, aber keine einfache, frei definierbare externe HTTP-Route direkt aus einem normalen Community-Modul heraus.

Quellen:

- https://foundryvtt.com/article/module-development/
- https://foundryvtt.com/api/interfaces/foundry.packages.types.ModuleManifestData.html

Die offizielle Moduldoku beschreibt Manifest, ESModules und Modul-Sockets. Eine frei definierbare serverseitige HTTP-Route als Standard-Community-Moduloberflaeche ist dort nicht der zentrale Weg. Deshalb trennt dieses Repo weiterhin bewusst:

1. Spiellogik und Datenzugriff in Foundry
2. Transport/Bridge nach aussen

Das Modul stellt eine stabile In-Foundry-API bereit:

- `game.modules.get("jenny-foundry-bridge").api.handleRequest(request)`

und registriert zusaetzlich einen Modul-Socket:

- `module.jenny-foundry-bridge`

Der aktuell implementierte Standardtransport ist Polling.

## Request-Format

```json
{
  "action": "roll",
  "channelKey": "foundry",
  "payload": {
    "notation": "1d20+5",
    "label": "Longsword attack",
    "actorRef": "Sir Garrick"
  }
}
```

Unterstuetzte Actions:

- `roll`
- `character`
- `campaignInfo`

## In-Foundry spielen

Das Modul bringt ein eigenes GM-Panel mit. Dieses sendet Eingaben direkt an den Bot-Kanal und laedt den letzten Kanalverlauf wieder in Foundry.

Aktuell ist die Verantwortlichkeit so getrennt:

- Bot/Discord-Kanal: eigentlicher KI-Dungeon-Master
- Foundry: autoritative Spielwelt fuer Wuerfe, Charaktere und Kampagneninfos
- Foundry-Panel: Bedienoberflaeche zum Spielen direkt in Foundry

## Externe Charaktere

Das Setting `External character map JSON` erwartet derzeit eine JSON-Liste wie:

```json
[
  {
    "characterRef": "Alice",
    "source": "dndbeyond",
    "characterId": "157298164"
  }
]
```

Wenn ein Character dort hinterlegt ist, liefert die Character-Action ein Routing-Ergebnis statt Foundry-Daten.

## Installation

1. Repository nach `{Foundry User Data}/Data/modules/jenny-foundry-bridge` legen.
2. Modul in Foundry aktivieren.
3. In den Moduleinstellungen `channelKey` und `sharedSecret` setzen.
4. `Transport mode` auf `polling` setzen.
5. Einen GM-Client offen lassen, damit Requests verarbeitet werden.

## Installation ueber Add-on Modules

Du kannst das Modul direkt per Manifest-URL aus dem GitHub-Repository installieren. Ein GitHub Release ist dafuer nicht zwingend noetig.

### Manifest-URL fuer Foundry

In Foundry bei `Add-on Modules` -> `Install Module` unten im Feld `Manifest URL` diese URL eintragen:

```text
https://raw.githubusercontent.com/Bullseye1979/foundry-bridge/main/module.json
```

Das Manifest zeigt derzeit auf den Hauptbranch als Download-Quelle:

```text
https://github.com/Bullseye1979/foundry-bridge/archive/refs/heads/main.zip
```

### Was du dafuer tun musst

1. Aendere lokal den Code.
2. Committe die Aenderungen.
3. Push auf `main`.

```bash
cd ~/jenny-the-bot/repo-foundry-jenny-bridge
git add .
git commit -m "Update module"
git push origin main
```

Danach kann Foundry das Manifest direkt aus GitHub lesen.

### Hinweis zu Updates

Diese Variante ist fuer private oder laufende Entwicklung bequem, weil sie direkt auf `main` zeigt.

Spaeter kannst du optional immer noch auf GitHub-Releases umstellen, wenn du:

- feste Versionen verteilen willst
- reproduzierbare Installationen willst
- sauberere Update-Staende bevorzugst
