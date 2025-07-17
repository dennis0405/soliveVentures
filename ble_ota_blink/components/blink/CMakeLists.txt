idf_component_register(
    SRCS "src/blink.c"
    INCLUDE_DIRS "include"
    REQUIRES 
        led_strip 
        driver
)
