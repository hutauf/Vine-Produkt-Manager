# Plan zur Implementierung von Revisionssicherheit (GoBD)

## 1. Zielsetzung

Das aktuelle System überschreibt bei Änderungen die Produktdaten direkt in der Datenbank. Dies widerspricht den Grundsätzen zur ordnungsmäßigen Führung und Aufbewahrung von Büchern, Aufzeichnungen und Unterlagen in elektronischer Form sowie zum Datenzugriff (GoBD), die eine lückenlose und unveränderbare Historie (Revisionssicherheit) fordern.

Ziel ist es, das System so zu erweitern, dass jede Änderung an einem Produkt permanent und mit Zeitstempel protokolliert wird. Es soll jederzeit nachvollziehbar sein, wer, wann, was und warum geändert hat.

## 2. Notwendige Anpassungen: Backend

Das Backend muss grundlegend erweitert werden, um eine Änderungshistorie zu speichern und bereitzustellen.

### 2.1. Datenbank-Schema anpassen

Die zentrale Änderung ist die Einführung einer neuen Tabelle, z.B. `ProductHistory`, zur Protokollierung aller Änderungen. Die bestehende `Products`-Tabelle behält weiterhin den *aktuellen* Zustand jedes Produkts, um die Performance für die normalen Lesezugriffe nicht zu beeinträchtigen.

**Neue Tabelle: `ProductHistory`**

| Spaltenname         | Datentyp          | Beschreibung                                                                                             |
| ------------------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| `history_id`        | INT / BIGINT      | Primärschlüssel der Tabelle.                                                                             |
| `product_id`        | INT / UUID        | Fremdschlüssel, der auf das entsprechende Produkt in der `Products`-Tabelle verweist.                    |
| `timestamp`         | DATETIME / BIGINT | Zeitstempel der Änderung (UTC).                                                                          |
| `user_id`           | INT / UUID        | ID des Benutzers, der die Änderung vorgenommen hat (wichtig für die Nachvollziehbarkeit).                |
| `changed_field`     | VARCHAR(255)      | Das Feld, das geändert wurde (z.B. "status", "notes", "estimated_value").                                |
| `old_value`         | TEXT              | Der Wert des Feldes *vor* der Änderung.                                                                  |
| `new_value`         | TEXT              | Der Wert des Feldes *nach* der Änderung.                                                                 |
| `reason`            | TEXT              | Ein optionales Feld für den Grund der Änderung (z.B. "Produkt entsorgt", "Korrektur des Bestellwerts"). |
| `change_type`       | VARCHAR(50)       | Art der Änderung, z.B. "CREATED", "UPDATED", "DELETED".                                                  |

### 2.2. API-Endpunkte anpassen

#### `PUT /api/products/:id` (Produkt aktualisieren)

Dieser Endpunkt darf die Daten nicht mehr einfach überschreiben. Die Logik muss wie folgt geändert werden:

1.  **Transaktion starten:** Alle folgenden Datenbankoperationen müssen in einer atomaren Transaktion gekapselt werden.
2.  **Alten Zustand laden:** Lese den aktuellen Zustand des Produkts aus der `Products`-Tabelle.
3.  **Änderungen vergleichen:** Vergleiche die eingehenden Daten aus dem Request mit dem alten Zustand, um die geänderten Felder zu identifizieren.
4.  **Historie schreiben:** Für jedes geänderte Feld wird ein neuer Eintrag in der `ProductHistory`-Tabelle erstellt.
5.  **Produkt aktualisieren:** Der neue Zustand wird in die `Products`-Tabelle geschrieben.
6.  **Transaktion abschließen:** Commit der Transaktion.

#### `POST /api/products` (Neues Produkt erstellen)

Beim Erstellen eines neuen Produkts wird ebenfalls ein Eintrag in `ProductHistory` mit dem `change_type` "CREATED" angelegt. `old_value` ist hier `NULL`.

#### Neuer Endpunkt: `GET /api/products/:id/history`

Es muss einen neuen Endpunkt geben, über den das Frontend die gesamte Historie für ein Produkt abrufen kann.

-   **Request:** `GET /api/products/123/history`
-   **Response:** Eine Liste von History-Einträgen, sortiert nach `timestamp` (absteigend), z.B.:
    ```json
    [
      {
        "timestamp": "2025-01-30T14:00:00Z",
        "user": "Hutauf",
        "changed_field": "status",
        "old_value": "Lager",
        "new_value": "entsorgt",
        "reason": "Produkt wurde zum Wertstoffhof gebracht"
      },
      {
        "timestamp": "2025-01-10T11:30:00Z",
        "user": "Hutauf",
        "changed_field": "notes",
        "old_value": "",
        "new_value": "Produkt wurde eingelagert weil dummes Produkt"
      },
      {
        "timestamp": "2025-01-10T11:29:00Z",
        "user": "Hutauf",
        "changed_field": "status",
        "old_value": "bestellt",
        "new_value": "Lager"
      },
      {
        "timestamp": "2025-01-01T10:00:00Z",
        "user": "Hutauf",
        "change_type": "CREATED",
        "new_value": "Produkt 'Super-Toaster' erstellt"
      }
    ]
    ```

## 3. Notwendige Anpassungen: Frontend

Das Frontend muss die neue Funktionalität abbilden und die Änderungshistorie visualisieren.

### 3.1. API-Service erweitern (`utils/apiService.ts`)

-   Eine neue Funktion `getProductHistory(productId)` muss hinzugefügt werden, die den neuen Endpunkt `GET /api/products/:id/history` aufruft.

### 3.2. Neue Komponente: `ProductHistoryView.tsx`

-   Diese Komponente ist für die Darstellung der Historie zuständig.
-   Sie erhält eine `productId` als Prop.
-   Mit einem `useEffect`-Hook ruft sie `getProductHistory` auf und speichert die Daten in einem State.
-   Die Historie wird in einer geeigneten Form (z.B. als chronologische Liste oder Tabelle) gerendert. Jede Zeile sollte Datum, Benutzer, Feld, alten/neuen Wert und Grund anzeigen.

### 3.3. Integration in die Benutzeroberfläche

-   Die `ProductHistoryView`-Komponente muss in die Produktdetailansicht integriert werden.
-   Ein guter Ort wäre ein neuer Tab "Historie" innerhalb des `EditProductModal.tsx`.
-   Alternativ könnte ein Button in der `ProductTable.tsx` direkt ein Modal mit der Historie öffnen.

### 3.4. Anpassung der Bearbeitungslogik

-   Beim Speichern von Änderungen im `EditProductModal.tsx` könnte ein optionales Feld "Grund der Änderung" hinzugefügt werden, dessen Inhalt an das Backend gesendet und in der `ProductHistory`-Tabelle in der Spalte `reason` gespeichert wird.

## 4. Testen

-   **Backend:** Unit-Tests für die neue Historienlogik.
-   **Frontend:** Komponenten-Tests für die `ProductHistoryView`.
-   **End-to-End:** Ein Test, der ein Produkt über die UI ändert und dann überprüft, ob der korrekte Eintrag in der Historienansicht erscheint.
