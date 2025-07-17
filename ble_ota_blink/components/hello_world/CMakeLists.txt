idf_component_register(
    SRCS "src/hello_world.c"
    INCLUDE_DIRS "include"
    REQUIRES spi_flash
    # esp_system, log 
)
