# Sesame HR API - Documentación para Time Tracking

Esta documentación describe los endpoints de la API de Sesame HR necesarios para crear una aplicación que muestre el tiempo total de trabajo de un empleado, su estado actual (trabajando/en descanso), y el tiempo de descanso.

## Configuración Base

### URL Base
```
https://{backMobileSubdomain}.sesametime.com/core/api
```

Donde `{backMobileSubdomain}` depende del entorno:
- Producción: `back-mobile`
- Staging: `back-mobile-staging`
- Otros ambientes: consultar documentación específica

### Headers Requeridos
Todas las peticiones requieren los siguientes headers:

```http
Authorization: Bearer {token}
ESID: {employeeId}
CSID: {companyId}
RSRC: 37
Content-Type: application/json
```

- `{token}`: Token de autenticación del usuario
- `{employeeId}`: ID del empleado
- `{companyId}`: ID de la empresa
- `RSRC: 37`: Identificador de recurso (constante para mobile)

## Endpoints Principales

### 1. Obtener Estado Actual del Empleado

**Endpoint:** `GET /employees/{employeeId}/checks`

**Descripción:** Obtiene el historial de checks (entradas, salidas, pausas) del empleado. El último check indica el estado actual.

**Parámetros de Query (opcionales):**
- `page`: Número de página (default: 1)
- `limit`: Número de resultados por página (default: 10)

**Ejemplo de Request:**
```http
GET /employees/12345/checks?page=1&limit=1
```

**Ejemplo de Response:**
```json
{
    "data": [
        {
            "id": "67890",
            "employeeId": "12345",
            "checkIn": {
                "date": "2025-10-27T08:00:00Z",
                "checkTypeId": "1",
                "workCheckTypeId": "101"
            },
            "checkOut": null,
            "status": "active"
        }
    ],
    "total": 150,
    "page": 1,
    "limit": 1
}
```

**Interpretación del estado:**
- Si `checkOut` es `null` y existe `checkIn`: El empleado está trabajando
- Si tanto `checkIn` como `checkOut` tienen valores: El empleado ha terminado su jornada
- Si el último registro es de tipo "pause": El empleado está en descanso

### 2. Obtener Estadísticas de Tiempo Trabajado

**Endpoint:** `GET /employees/{employeeId}/daily-computed-hour-stats`

**Descripción:** Obtiene las estadísticas de horas trabajadas del día actual, incluyendo tiempo trabajado y tiempo esperado.

**Ejemplo de Request:**
```http
GET /employees/12345/daily-computed-hour-stats
```

**Ejemplo de Response:**
```json
{
    "data": {
        "date": "2025-10-27",
        "employeeId": "12345",
        "workedSeconds": 14400,
        "secondsToWork": 28800,
        "breakSeconds": 1800,
        "overtimeSeconds": 0,
        "balance": -14400
    }
}
```

**Campos importantes:**
- `workedSeconds`: Segundos totales trabajados en el día
- `secondsToWork`: Segundos que el empleado debe trabajar según su jornada
- `breakSeconds`: Segundos totales en descanso
- `balance`: Diferencia entre lo trabajado y lo esperado (negativo = falta tiempo, positivo = horas extra)

**Conversión a horas:**
```javascript
const horas = workedSeconds / 3600;  // Ejemplo: 14400 / 3600 = 4 horas
const minutos = (workedSeconds % 3600) / 60;  // Ejemplo: 0 minutos
```

### 3. Obtener Tipos de Descanso del Empleado

**Endpoint:** `GET /employees/{employeeId}/work-breaks-by-employee`

**Descripción:** Obtiene todos los tipos de descansos/pausas asignados al empleado.

**Ejemplo de Request:**
```http
GET /employees/12345/work-breaks-by-employee
```

**Ejemplo de Response:**
```json
{
    "data": [
        {
            "id": "201",
            "name": "Descanso comida",
            "duration": 1800,
            "paid": false,
            "companyId": "5678"
        },
        {
            "id": "202",
            "name": "Descanso café",
            "duration": 900,
            "paid": true,
            "companyId": "5678"
        }
    ]
}
```

**Campos importantes:**
- `name`: Nombre del tipo de descanso
- `duration`: Duración del descanso en segundos
- `paid`: Si el descanso es pagado o no

### 4. Obtener Lista de Empleados Trabajando Actualmente

**Endpoint:** `GET /companies/{companyId}/working-employees`

**Descripción:** Obtiene la lista de todos los empleados que están trabajando actualmente en la empresa.

**Ejemplo de Request:**
```http
GET /companies/5678/working-employees
```

**Ejemplo de Response:**
```json
{
    "data": [
        {
            "employeeId": "12345",
            "fullName": "Juan Pérez",
            "workStatus": "online",
            "checkInTime": "2025-10-27T08:00:00Z"
        },
        {
            "employeeId": "12346",
            "fullName": "María García",
            "workStatus": "paused",
            "checkInTime": "2025-10-27T08:30:00Z",
            "pauseStartTime": "2025-10-27T12:00:00Z"
        }
    ]
}
```

### 5. Verificar Quién Está Online/Offline

**Endpoint Online:** `GET /whosin-online`

**Endpoint Offline:** `GET /whosin-offline`

**Descripción:** Obtiene listas de empleados online u offline.

**Parámetros de Query:**
- `page`: Número de página
- `limit`: Resultados por página

**Ejemplo de Request:**
```http
GET /whosin-online?page=1&limit=20
```

## Estados de Trabajo (workStatus)

El campo `workStatus` puede tener los siguientes valores:

- `"online"`: El empleado está trabajando activamente
- `"paused"`: El empleado está en descanso/pausa
- `"offline"`: El empleado no está trabajando
- `"remote"`: El empleado está trabajando de forma remota

## Operaciones de Check-In/Out/Pause

### Check-In (Entrada)

**Endpoint:** `POST /employees/{employeeId}/check-in`

**Body:**
```json
{
    "workCheckTypeId": "101",
    "date": "2025-10-27T08:00:00Z",
    "coordinates": {
        "latitude": 40.416775,
        "longitude": -3.703790
    }
}
```

### Check-Out (Salida)

**Endpoint:** `POST /employees/{employeeId}/check-out`

**Body:**
```json
{
    "date": "2025-10-27T17:00:00Z",
    "coordinates": {
        "latitude": 40.416775,
        "longitude": -3.703790
    }
}
```

### Pause (Iniciar Descanso)

**Endpoint:** `POST /employees/{employeeId}/pause`

**Body:**
```json
{
    "workBreakId": "201",
    "date": "2025-10-27T12:00:00Z"
}
```

## Flujo Recomendado para tu Aplicación

### 1. Al Cargar la Aplicación:

```
1. Obtener último check: GET /employees/{employeeId}/checks?page=1&limit=1
2. Obtener estadísticas del día: GET /employees/{employeeId}/daily-computed-hour-stats
3. Obtener tipos de descanso: GET /employees/{employeeId}/work-breaks-by-employee
```

### 2. Para Mostrar Estado Actual:

```javascript
// Pseudo-código de lógica
if (ultimoCheck.checkOut === null && ultimoCheck.checkIn !== null) {
    if (ultimoCheck.isPause) {
        estado = "En descanso";
        tiempoDescanso = calcularTiempoDesde(ultimoCheck.pauseStartTime);
    } else {
        estado = "Trabajando";
        tiempoTrabajado = estadisticas.workedSeconds;
    }
} else {
    estado = "Desconectado";
}
```

### 3. Para Actualizar en Tiempo Real:

Realizar polling cada 30-60 segundos a:
- `GET /employees/{employeeId}/checks?page=1&limit=1`
- `GET /employees/{employeeId}/daily-computed-hour-stats`

O implementar WebSockets para eventos en tiempo real:
- Evento: `EmployeeWorkStatusUpdated`
- Evento: `CheckUpdated`

## Manejo de Errores

### Códigos de Error Comunes:

- `401`: No autorizado - Token inválido o expirado
- `403`: Prohibido - No tienes permisos para acceder a este recurso
- `404`: No encontrado - El empleado o recurso no existe
- `422`: Entidad no procesable - Datos de entrada inválidos
- `500`: Error del servidor - Error interno del servidor

### Ejemplo de Response de Error:

```json
{
    "error": {
        "code": "UNAUTHORIZED",
        "message": "Token de autenticación inválido o expirado",
        "statusCode": 401
    }
}
```

## Ejemplo Completo de Uso

### Escenario: Mostrar tiempo trabajado y estado actual

```javascript
// 1. Obtener estadísticas del día
const stats = await fetch(`${baseUrl}/employees/${employeeId}/daily-computed-hour-stats`, {
    headers: {
        'Authorization': `Bearer ${token}`,
        'ESID': employeeId,
        'CSID': companyId,
        'RSRC': '37'
    }
});

const estadisticas = await stats.json();
const horasTrabajadas = estadisticas.data.workedSeconds / 3600;
const tiempoDescanso = estadisticas.data.breakSeconds / 3600;

// 2. Obtener último check para estado actual
const checks = await fetch(`${baseUrl}/employees/${employeeId}/checks?page=1&limit=1`, {
    headers: {
        'Authorization': `Bearer ${token}`,
        'ESID': employeeId,
        'CSID': companyId,
        'RSRC': '37'
    }
});

const ultimoCheck = await checks.json();
const check = ultimoCheck.data[0];

let estadoActual = "Desconectado";
if (check && !check.checkOut) {
    if (check.isPause) {
        estadoActual = "En descanso";
    } else {
        estadoActual = "Trabajando";
    }
}

// 3. Mostrar información
console.log(`Estado: ${estadoActual}`);
console.log(`Horas trabajadas hoy: ${horasTrabajadas.toFixed(2)}h`);
console.log(`Tiempo de descanso: ${tiempoDescanso.toFixed(2)}h`);
```

## Notas Importantes

1. **Autenticación:** Todos los endpoints requieren autenticación mediante Bearer token
2. **Rate Limiting:** La API puede tener límites de requests por minuto, considera implementar caching
3. **Fechas:** Todas las fechas están en formato ISO 8601 UTC
4. **IDs:** Todos los IDs son strings, no números
5. **Segundos:** Los tiempos se devuelven en segundos, debes convertirlos a horas/minutos según necesites
6. **Tiempo Real:** Para información en tiempo real, considera usar WebSockets en lugar de polling constante

## Soporte y Documentación Adicional

- Documentación oficial: https://docs.sesamehr.com
- Para más endpoints relacionados con horarios, consultar: `/src/api/models/DaySchedule.js`
- Para requests de modificación de checks, consultar: `/src/api/models/CheckRequest.js`
