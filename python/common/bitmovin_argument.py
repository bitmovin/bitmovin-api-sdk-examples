class BitmovinArgument(object):
    def __init__(self, description, required=False, value=None):
        self.description = description
        self.required = required
        self.value = value
