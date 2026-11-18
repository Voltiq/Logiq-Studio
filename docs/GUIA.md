# Manual de Logiq Studio

Logiq Studio es un editor de programas y páginas web que además te muestra la estructura de tu código: las clases que escribes aparecen como un diagrama de clases UML que se vuelve a dibujar mientras escribes. Este manual recorre la ventana de izquierda a derecha y después las cosas que más harás.

## La ventana

- **La barra superior** tiene los menús, un campo de búsqueda de archivos y comandos, y el botón **Ejecutar**.
- **La barra de la izquierda** cambia la barra lateral: Explorador, Buscar, Esquema, Control de código fuente, Depurador. Debajo están el diagrama de clases y el terminal, y al final los ajustes.
- **El centro** contiene tus archivos abiertos como pestañas. Arrastra un archivo del explorador, o una pestaña, a la parte derecha del editor para ver dos archivos juntos; el editor muestra dónde caerá antes de soltarlo.
- **El panel inferior** muestra la salida de un programa, los problemas, las pruebas, los resultados de SQL, JShell y el terminal. `Ctrl+J` lo muestra y lo oculta.
- **La barra de estado** muestra errores y avisos, la rama de Git, la posición del cursor y la herramienta con la que se ejecuta el archivo. Casi todos sus elementos se pueden pulsar.

## Proyectos y archivos

Un proyecto es una carpeta. Abre una con **Archivo → Abrir carpeta…** (`Ctrl+O`), o empieza una nueva a partir de una plantilla con **Archivo → Nuevo proyecto…** (`Ctrl+Mayús+N`): clases Java, un programa de consola, una ventana Swing, una página web, Python, C, C++, Kotlin, PHP, SQL, Maven o Gradle.

En el Explorador, haz clic derecho en una carpeta para crear archivos, clases y carpetas; arrastra archivos para moverlos; `F2` renombra y `Supr` mueve a la Papelera de reciclaje. `Ctrl+P` abre un archivo escribiendo parte de su nombre, y `Ctrl+Mayús+P` encuentra cualquier comando.

Los cambios sin guardar y las pestañas abiertas vuelven la próxima vez que inicies, salvo que lo desactives en Ajustes.

## Escribir código

El editor colorea el código, cierra los paréntesis, sangra y subraya los errores mientras escribes. Teclas útiles:

| Tecla | Qué hace |
| --- | --- |
| `Ctrl+Espacio` | Sugerencias de lo que se puede escribir aquí |
| `F12` o `Ctrl`+clic | Ir a la definición de un nombre |
| `Mayús+F12` | Buscar dónde se usa un nombre |
| `F2` | Renombrar un nombre en todas partes |
| `Ctrl+.` | Correcciones rápidas para el problema del cursor |
| `Ctrl+Mayús+R` | Refactorizar: extraer una variable, un método y más |
| `Mayús+Alt+F` | Dar formato al archivo |
| `Ctrl+/` | Convertir líneas en comentario y al revés |
| `Ctrl+F` | Buscar y reemplazar en el archivo |
| `Ctrl+Mayús+F` | Buscar en todos los archivos |

Para Java, **Ajustes → Java** puede instalar una vez el servidor de lenguaje de Java; entonces el autocompletado conoce todos los tipos y los errores aparecen sin compilar. C y C++ usan clangd, y Python usa Pyright o pylsp, cuando están instalados.

Los **fragmentos** escriben trozos enteros de código a partir de una palabra corta: escribe `sysout` y pulsa `Ctrl+Espacio` o `Tab` para `System.out.println();`, `fori` para un bucle contador, `main` para el método main, o `!` en un archivo HTML para el esqueleto de la página (allí `Tab` es de Emmet, así que usa `Ctrl+Espacio`). Después `Tab` pasa al siguiente campo por rellenar. Cada lenguaje tiene los suyos; **Editar → Insertar fragmento…** muestra los del archivo. Los tuyos se escriben en **Ajustes → Fragmentos**, o selecciona código y usa **Editar → Guardar selección como fragmento…**; una palabra que des a uno tuyo lo llama en lugar del incorporado.

## Ejecutar programas

`F5` ejecuta lo que está abierto. Qué significa eso depende del archivo:

- **Java**: se compilan todas las clases y luego se ejecuta la clase con `main`. La salida aparece en el panel; escribe allí cuando el programa lea del teclado.
- **Python, C, C++, Kotlin, PHP, JavaScript**: el archivo se ejecuta con su intérprete o se compila antes. La barra de estado muestra qué herramienta se usa; púlsala para elegir otra.
- **Las páginas HTML y PHP** se abren en la vista previa en vivo junto al editor, que se recarga al guardar.
- **SQL** se ejecuta contra la base de datos SQLite indicada en el primer comentario del archivo (`-- database: shop.db`), o contra una nueva en memoria. `Ctrl+Intro` ejecuta solo la sentencia del cursor. Las filas aparecen como una tabla en el panel Resultados.

`Ctrl+F9` compila o comprueba sin ejecutar, y `Mayús+F5` detiene un programa. Los errores se listan en **Problemas**; pulsa uno para ir a su línea. **Ejecutar → Configuración de ejecución…** establece los argumentos del programa.

Para encontrar un error, pon un punto de interrupción con `F9` e inicia el depurador con `F6`: el programa se detiene ahí, y puedes recorrerlo línea a línea y mirar las variables.

## El diagrama de clases

**Ver → Mostrar el diagrama de clases UML** (`Ctrl+Mayús+U`) dibuja las clases de tu código Java y Python: atributos y métodos con su visibilidad (`+` público, `-` privado, `#` protegido), la herencia y los enlaces entre clases.

- Arrastra las cajas para ordenarlas; la disposición se guarda con el proyecto. **Organizar automáticamente** lo coloca todo de nuevo.
- Haz doble clic en una clase o en un miembro para saltar a su código.
- Haz clic derecho en una clase Java para añadir atributos, métodos y constructores, o para crear un objeto de ella en el **banco de objetos**, bajo el diagrama, y llamar a sus métodos.
- **Nueva clase** crea una clase con un asistente; las herramientas de herencia y asociación dibujan enlaces que se escriben en el código.
- **Agregación y composición**: haz clic derecho en una asociación y elige si es una agregación (una parte que puede existir por sí sola, rombo vacío) o una composición (una parte que pertenece a su todo, rombo relleno). La elección se guarda para el proyecto y aparece en cada diagrama y en la exportación a PlantUML y Mermaid.
- **Exportar** guarda el diagrama como SVG, PNG, PlantUML o Mermaid.
- **Deshacer**: `Ctrl+Z` deshace lo que hiciste en el diagrama (mover cajas, notas, líneas, ocultar clases y el código que escribió: miembros, relaciones, clases nuevas, agregaciones); `Ctrl+Y` lo rehace.

Con el teclado: `Tab` entra en el diagrama, las flechas van de clase en clase, `Intro` abre el código y la tecla de menú abre el menú de la clase.

## Diseñar ventanas

**Archivo → Nueva ventana Swing…** crea una clase de ventana y la abre en el diseñador de interfaces. Arrastra botones, etiquetas y campos de texto desde la izquierda hasta la ventana, muévelos y cambia su tamaño (se ajustan unos a otros), y establece sus propiedades a la derecha.

Para decir qué hace un botón, haz doble clic en él: se escribe un método como `okButton_ActionPerformed` para que lo rellenes. El diseñador solo escribe el código entre los comentarios `// GUI-BEGIN` y `// GUI-END`; el resto de la clase es tuyo, y lo que cambies en el código se ve en el diseñador.

## Diagramas de Nassi-Shneiderman

Un diagrama de Nassi-Shneiderman muestra cómo funciona un método: secuencias, decisiones, bucles y selecciones como cajas anidadas.

- **A partir del código**: pon el cursor en un método de Java y elige **Ver → Diagrama de Nassi-Shneiderman de este método** (`Ctrl+Alt+N`). Se abre junto al código y lo sigue mientras escribes.
- **Sin código**: **Archivo → Nuevo diagrama de Nassi-Shneiderman** crea un archivo `.nsd`. Selecciona un bloque y añade después instrucciones, decisiones, bucles, selecciones, llamadas y salidas; haz doble clic en un bloque para cambiar su texto y en ∅ para llenar una rama vacía. **Editar una copia** convierte un diagrama hecho a partir del código en uno que puedes cambiar.
- **Exportar** como PNG o SVG, o copiarlo como imagen.

## Git

La vista Control de código fuente (`Ctrl+Mayús+G`) lista los archivos cambiados. Prepara los que van juntos, escribe un mensaje y pulsa **Confirmar** (`Ctrl+Intro`). El botón de las flechas recibe y envía (pull y push).

Las líneas cambiadas se marcan en el borde izquierdo del editor; pulsa una marca para ver el texto antiguo y el nuevo uno junto al otro. El nombre de la rama en la barra de estado cambia de rama, fusiona y hace rebase. Cuando una fusión encuentra un conflicto, abre el archivo y elige encima de cada conflicto qué lado se queda. Las reservas, las etiquetas y el historial están en la misma vista; `Ctrl+Alt+B` muestra quién cambió cada línea por última vez.

## Terminal

``Ctrl+` `` abre un terminal en la carpeta del proyecto, con el JDK y el entorno de Python del proyecto listos. Puede haber varios terminales abiertos a la vez.

## Ajustes

`Ctrl+,` abre los ajustes: tema (Grafito es oscuro, Porcelana claro), idioma, tamaño del texto, guardado y formato, el intérprete del terminal, las herramientas de cada lenguaje, el JDK y las actualizaciones. **Exportar ajustes…** los escribe en un archivo que puedes importar en otro equipo. Elige una sección a la izquierda o busca un ajuste por su nombre.

## Cuando algo va mal

- **«No se encontró ningún JDK»**, o ningún compilador para C, C++, Python o PHP: abre Ayuda → Configurar lenguajes. Muestra lo que necesita cada lenguaje y lo que está instalado; «Instalar» lo configura con winget en un terminal y Logiq Studio lo usa en cuanto está listo.
- **Falta la herramienta de un lenguaje**: la barra de estado lo dice; su información emergente explica cómo instalarla.
- **El programa espera y no pasa nada**: probablemente espera una entrada. Escribe en el campo bajo la salida y pulsa Intro.
- **Logiq Studio se cerró inesperadamente**: se guarda un informe del fallo en tu equipo. **Ayuda → Mostrar el archivo de registro** abre la carpeta; adjuntar el informe a un informe de error ayuda a corregir la causa.

Todos los atajos de teclado están en **Ayuda → Atajos de teclado** (`Ctrl+K`).
