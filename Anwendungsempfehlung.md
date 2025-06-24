# Anwendungsempfehlung

Diese kurze Anleitung beschreibt, wie der **Vine Produkt Manager** typischerweise eingesetzt wird und welche rechtlichen Rahmenbedingungen zu beachten sind. Im Vordergrund steht der Ablauf aus Sicht eines Vine Produkttesters, der eine Einnahmen-Überschuss-Rechnung (EÜR) erstellen muss.

## 1. Zielgruppe

Dieser Produktmanager richtet sich an Vine-Produkttester, die eine EÜR abgeben wollen oder müssen und dabei nicht einfach nur den ETV versteuern wollen. Ansonsten macht das hier keinen Sinn.

## 2. Hosting

Der **Vine Produkt Manager** ist eine statische Webseite, d.h. ihr könnt sie selbst hosten oder ihr nutzt mein Hosting: [Vine Produkt Manager](https://hutauf.github.io/vine-produkt-manager)

Ihr könnt den **Vine Produkt Manager** dort einfach mal austesten - einfach in den Einstellungen mit einem Klick den Demo-Token laden, dann habt ihr Fake-Daten. Dort bitte keine persönlichen Daten hinterlegen, da sie mit dem Demo-Token auch ins Backend synchronisiert werden.


## 3. Datenimport

1. Exportiere deine Produktdaten mit dem [hutauf/VineTaxTools](https://github.com/hutauf/VineTaxTools/) Userscript. Du erhältst eine JSON-Datei mit allen relevanten Angaben.
2. Lade diese Datei im Dashboard des Produkt Managers hoch. Solange kein API-Token hinterlegt ist, werden alle Informationen ausschließlich lokal im Browser gespeichert und verarbeitet.
3. Optional kannst du einen Token von hutauf oder aus einem eigenen Backend hinterlegen. Dann erfolgt eine Synchronisation mit dem Server. Die Daten verbleiben dennoch lokal und lassen sich jederzeit manuell exportieren und später wieder importieren.

## 4. Produktstatus festhalten

Im Dashboard dokumentierst du, ob ein Produkt eingelagert, verkauft oder entsorgt wurde. Jede Änderung fließt automatisch in die EÜR ein.

## 5. Automatisch erzeugte EÜR

Die Anwendung erstellt eine Übersicht der Einnahmen und Ausgaben. Du kannst jederzeit sehen, ob Produkte aktuell im Lager (Umlaufvermögen) oder im Betriebsvermögen (Anlageverzeichnis) geführt werden und wie sich Verkäufe oder Entnahmen auswirken.

## 6. Belege exportieren

Um die Daten GoBD-konform in ein externes Buchhaltungsprogramm (z. B. Lexware Office) zu übernehmen, bietet der Produkt Manager einen Beleg-Export. Dabei werden Proforma-Rechnungen generiert, die zeitnah in deiner Buchhaltungssoftware festgeschrieben werden sollten.

## 7. Flexibler Datenfluss

Du entscheidest selbst, wie viel Aufwand du betreiben möchtest. Die Anwendung funktioniert komplett offline, wenn du keinen Token nutzt. Mit Token synchronisierst du zusätzlich mit dem Server. In jedem Fall behältst du die Möglichkeit, alle Daten zu exportieren und später wieder zu importieren. Du kannst du Anwendung einmal im Jahr zur Aufbereitung der Amazon-Produktliste nutzen oder auch täglich. Nach gobd müssen alle Buchungen unverzüglich erfolgen, aber gängige Praxis bei kleinen Unternehmen ist, solche Belege nur einmal im Jahr zu archivieren und damit die EÜR zu berechnen.

## 8. Weitere Infos

- Es liegt im Dashboard ein großer Fokus auf einem Gewerbe mit Verkaufsintention der Vine-Produkte. Das hat steuerrechtliche Gründe. Wie sicher alle wissen, ist die Einschätzung, ob eine Sachzuwendung beim Empfänger als geldwerter Vorteil gewertet wird, insgesamt eine Grauzone und auch die Rechtsprechung ändert dort auch mal ihre Meinung (siehe beispielsweise BFH-Urteil 18.8.2005 - VI R 32/03). Meiner Ansicht nach kann es fraglich sein, wenn du ein Produkt bestellst *um* es privat zu nutzen. Denn dann ist der Zweck der Bestellung die private Nutzung, somit könnte das Finanzamt argumentieren, dass du den Produkttest selbst nicht als Aufwand geltend machen kannst. Wenn du das Produkt jedoch bestellst, *um* es später zu verkaufen, dann ist der Zweck der Bestellung ein betrieblich bedingter. Du kannst das Produkt dann wahlweise steuerneutral einlagern oder später irgendwann verkaufen. Solltest du deine Meinung ändern und das Produkt doch nutzen wollen, dann entnimmst du das Produkt zu diesem Zeitpunkt privat, was steuerrechtlich mit dem Teilwert bewertet wird, also jetzt kann man eigentlich nicht mehr mit dem Fremdvergleich argumentieren, weil wir weg vom §8 EStG sind. Außerdem wird der Entnahmepreis wie bei anderen Verkäufern bewertet und auch dann wäre ein Wiederbeschaffungswert (für uns worst case) nur als Einkaufspreis zu bewerten und nicht mit dem möglichen Verkaufspreis.
- Teilwert v2 (Einstellungen) ist derzeit für euch ohne Funktion. Wird noch verändert.
- Produkte, die eingelagert sind und erst im nächsten Jahr verkauft werden, werden derzeit nicht unterstützt.
- Dass Produkte direkt mit dem Teilwert als Einnahme gebucht werden können, ist eine Vereinfachung, die zumindest von meinem Finanzamt akzeptiert wird. Das reduziert jedoch den Umsatz bezüglich der Kleinunternehmerregelung unrechtmäßig. Die Einkommenssteuer wird jedoch identisch berechnet.

---

Diese Empfehlungen sollen dir helfen, den **Vine Produkt Manager** effizient zu nutzen und gleichzeitig deine steuerlichen Pflichten zu erfüllen.
